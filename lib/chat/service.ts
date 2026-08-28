import 'server-only';

import { and, asc, desc, eq, gt, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  familyMembers,
  messageReactions,
  messageReads,
  messages,
  users,
} from '@/lib/db/schema';
import { requireMembership } from '@/lib/permissions/family';
import { Errors } from '@/lib/api/errors';
import { publishEvent } from '@/lib/realtime/publish';
import { notifyFamily } from '@/lib/notifications/service';

/**
 * Family chat.
 *
 * One thread per family — no channels, no direct messages, no threading. The
 * brief is explicit that group-chat complexity is out of scope, and a single
 * shared conversation is what a household actually uses.
 *
 * Deletion is soft. Removing a row would silently reorder the conversation
 * around whoever deleted something; a tombstone keeps the thread honest about
 * the fact that a message was there.
 */

const MAX_MESSAGE_LENGTH = 2_000;

/** How much of a message a notification shows. */
const PREVIEW_LENGTH = 120;

/**
 * Someone who read the thread this recently is looking at it now.
 *
 * The chat view marks the thread read as messages arrive, so a very recent
 * mark is the closest thing the server has to "this person is watching".
 * Pushing to them would buzz a phone whose owner is already reading.
 */
const ACTIVE_READER_WINDOW_MS = 60_000;

function preview(content: string): string {
  const collapsed = content.replace(/\s+/g, ' ').trim();
  return collapsed.length > PREVIEW_LENGTH
    ? `${collapsed.slice(0, PREVIEW_LENGTH - 1)}…`
    : collapsed;
}

/** Members whose phones should stay quiet because they are already reading. */
async function activeReaders(familyId: string, exclude: string): Promise<string[]> {
  const since = new Date(Date.now() - ACTIVE_READER_WINDOW_MS);

  const rows = await db
    .select({ userId: messageReads.userId })
    .from(messageReads)
    .where(
      and(
        eq(messageReads.familyId, familyId),
        gt(messageReads.lastReadAt, since),
        ne(messageReads.userId, exclude),
      ),
    );

  return rows.map((r) => r.userId);
}
const DEFAULT_PAGE_SIZE = 50;

export interface MessageView {
  id: string;
  senderId: string;
  senderName: string;
  senderImage: string | null;
  content: string;
  deleted: boolean;
  createdAt: Date;
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A page of messages, newest first.
 *
 * `before` pages backwards through history. Returning newest-first matches how
 * a chat loads — the most recent screen, then older on demand — and the client
 * reverses for display.
 */
export async function listMessages(
  callerId: string,
  familyId: string,
  options: { limit?: number; before?: Date } = {},
): Promise<MessageView[]> {
  await requireMembership(callerId, familyId);

  const limit = Math.min(options.limit ?? DEFAULT_PAGE_SIZE, 100);

  const rows = await db
    .select({
      id: messages.id,
      senderId: messages.senderId,
      senderName: users.name,
      senderImage: users.image,
      content: messages.content,
      deletedAt: messages.deletedAt,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .innerJoin(users, eq(users.id, messages.senderId))
    .where(
      options.before
        ? and(eq(messages.familyId, familyId), lt(messages.createdAt, options.before))
        : eq(messages.familyId, familyId),
    )
    .orderBy(desc(messages.createdAt))
    .limit(limit);

  return rows.map(({ deletedAt, content, ...rest }) => ({
    ...rest,
    deleted: deletedAt !== null,
    // A deleted message keeps its slot in the thread but not its content.
    content: deletedAt !== null ? '' : content,
  }));
}

/** Messages newer than a timestamp, oldest first — used to append after a hint. */
export async function listMessagesSince(
  callerId: string,
  familyId: string,
  since: Date,
): Promise<MessageView[]> {
  await requireMembership(callerId, familyId);

  const rows = await db
    .select({
      id: messages.id,
      senderId: messages.senderId,
      senderName: users.name,
      senderImage: users.image,
      content: messages.content,
      deletedAt: messages.deletedAt,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .innerJoin(users, eq(users.id, messages.senderId))
    .where(and(eq(messages.familyId, familyId), gt(messages.createdAt, since)))
    .orderBy(asc(messages.createdAt))
    .limit(100);

  return rows.map(({ deletedAt, content, ...rest }) => ({
    ...rest,
    deleted: deletedAt !== null,
    content: deletedAt !== null ? '' : content,
  }));
}

/* -------------------------------------------------------------------------- */
/* Writing                                                                     */
/* -------------------------------------------------------------------------- */

export async function sendMessage(
  senderId: string,
  familyId: string,
  content: string,
): Promise<MessageView> {
  await requireMembership(senderId, familyId);

  const trimmed = content.trim();

  if (trimmed.length === 0) throw Errors.badRequest('Type a message first.');
  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    throw Errors.badRequest(`Messages are limited to ${MAX_MESSAGE_LENGTH} characters.`);
  }

  const [inserted] = await db
    .insert(messages)
    .values({ familyId, senderId, content: trimmed })
    .returning();

  if (!inserted) throw Errors.internal();

  const [sender] = await db
    .select({ name: users.name, image: users.image })
    .from(users)
    .where(eq(users.id, senderId))
    .limit(1);

  /*
   * Sending marks the thread read for the sender, so their own message never
   * shows up as an unread they have to dismiss.
   */
  await markThreadRead(senderId, familyId, inserted.createdAt);

  await publishEvent(familyId, 'message');

  const senderName = sender?.name ?? 'Someone';

  /*
   * Tell the rest of the family. Until this existed, chat published only the
   * in-app realtime hint above, so a message reached you solely if the app
   * happened to be open — and on a phone there was no badge either.
   *
   * notifyFamily never throws into this path, so a failed push cannot lose a
   * message that is already committed.
   */
  await notifyFamily({
    familyId,
    type: 'NEW_MESSAGE',
    title: senderName,
    message: preview(trimmed),
    data: { familyId, messageId: String(inserted.id), actorId: senderId },
    exclude: senderId,
    // One tray entry per family thread: a new message replaces the last
    // rather than stacking twenty deep.
    pushTag: `chat:${familyId}`,
    skipPushFor: await activeReaders(familyId, senderId),
  });

  return {
    id: inserted.id,
    senderId,
    senderName,
    senderImage: sender?.image ?? null,
    content: inserted.content,
    deleted: false,
    createdAt: inserted.createdAt,
  };
}

/**
 * Soft-deletes a message.
 *
 * The sender may delete their own; an owner or admin may delete anyone's,
 * which is the moderation the brief asks for without building a moderation
 * system.
 */
export async function deleteMessage(
  callerId: string,
  familyId: string,
  messageId: string,
): Promise<void> {
  const membership = await requireMembership(callerId, familyId);

  const [message] = await db
    .select({ senderId: messages.senderId, deletedAt: messages.deletedAt })
    .from(messages)
    // Scoped by family as well as id, so a message id from another family
    // cannot be reached.
    .where(and(eq(messages.id, messageId), eq(messages.familyId, familyId)))
    .limit(1);

  if (!message || message.deletedAt) throw Errors.notFound('That message');

  const isModerator = membership.role === 'owner' || membership.role === 'admin';

  if (message.senderId !== callerId && !isModerator) {
    throw Errors.forbidden('You can only delete your own messages.');
  }

  await db
    .update(messages)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(messages.id, messageId), eq(messages.familyId, familyId)));

  await publishEvent(familyId, 'message');
}

/* -------------------------------------------------------------------------- */
/* Reactions                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The reactions FamLink offers.
 *
 * A closed set rather than a free-text emoji field. It keeps the data
 * predictable, avoids storing arbitrary user input that has to be sanitised
 * everywhere it renders, and sidesteps a family app becoming a venue for
 * whatever emoji somebody felt like pasting.
 */
export const ALLOWED_REACTIONS = ['❤️', '👍', '😂', '😮', '😢', '🙏'] as const;
export type Reaction = (typeof ALLOWED_REACTIONS)[number];

export function isAllowedReaction(value: string): value is Reaction {
  return (ALLOWED_REACTIONS as readonly string[]).includes(value);
}

/**
 * Adds or replaces this member's reaction to a message.
 *
 * Sending the same emoji again removes it, which is what every chat app people
 * already use does.
 */
export async function reactToMessage(
  userId: string,
  familyId: string,
  messageId: string,
  emoji: string,
): Promise<void> {
  await requireMembership(userId, familyId);

  if (!isAllowedReaction(emoji)) {
    throw Errors.badRequest('That reaction is not available.');
  }

  // Scoped by family so a message id from elsewhere cannot be reacted to.
  const [message] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.familyId, familyId)))
    .limit(1);

  if (!message) throw Errors.notFound('That message');

  const [existing] = await db
    .select({ emoji: messageReactions.emoji })
    .from(messageReactions)
    .where(
      and(eq(messageReactions.messageId, messageId), eq(messageReactions.userId, userId)),
    )
    .limit(1);

  if (existing?.emoji === emoji) {
    await db
      .delete(messageReactions)
      .where(
        and(eq(messageReactions.messageId, messageId), eq(messageReactions.userId, userId)),
      );
  } else {
    await db
      .insert(messageReactions)
      .values({ messageId, userId, emoji })
      .onConflictDoUpdate({
        target: [messageReactions.messageId, messageReactions.userId],
        set: { emoji, createdAt: new Date() },
      });
  }

  await publishEvent(familyId, 'message');
}

export interface ReactionSummary {
  emoji: string;
  count: number;
  userIds: string[];
}

/** Reactions for a set of messages, grouped by message then emoji. */
export async function getReactions(
  userId: string,
  familyId: string,
  messageIds: string[],
): Promise<Map<string, ReactionSummary[]>> {
  await requireMembership(userId, familyId);

  if (messageIds.length === 0) return new Map();

  const rows = await db
    .select({
      messageId: messageReactions.messageId,
      userId: messageReactions.userId,
      emoji: messageReactions.emoji,
    })
    .from(messageReactions)
    .innerJoin(messages, eq(messages.id, messageReactions.messageId))
    .where(
      and(
        eq(messages.familyId, familyId),
        inArray(messageReactions.messageId, messageIds),
      ),
    );

  const byMessage = new Map<string, Map<string, ReactionSummary>>();

  for (const row of rows) {
    const forMessage = byMessage.get(row.messageId) ?? new Map();
    const summary = forMessage.get(row.emoji) ?? { emoji: row.emoji, count: 0, userIds: [] };

    summary.count += 1;
    summary.userIds.push(row.userId);

    forMessage.set(row.emoji, summary);
    byMessage.set(row.messageId, forMessage);
  }

  return new Map(
    [...byMessage.entries()].map(([messageId, emojiMap]) => [
      messageId,
      [...emojiMap.values()].sort((a, b) => b.count - a.count),
    ]),
  );
}

/* -------------------------------------------------------------------------- */
/* Unread tracking                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Moves this member's read high-water mark.
 *
 * Read state is a high-water mark rather than a per-message flag: one row per
 * member per family, with the unread count as a range count against it. Nobody
 * needs to know *which* messages you have seen, only how many you have not.
 *
 * INTERNAL — assumes the caller has already proved membership. Both call sites
 * do: `sendMessage` above, and the read endpoint, which checks explicitly.
 * Left unguarded because it runs on the message-send hot path, where a second
 * membership query buys nothing.
 */
export async function markThreadRead(
  userId: string,
  familyId: string,
  at: Date = new Date(),
): Promise<void> {
  await db
    .insert(messageReads)
    .values({ familyId, userId, lastReadAt: at })
    .onConflictDoUpdate({
      target: [messageReads.familyId, messageReads.userId],
      set: { lastReadAt: at },
      // Never move the mark backwards — an out-of-order request must not
      // resurrect messages the member has already seen.
      setWhere: lt(messageReads.lastReadAt, at),
    });
}

export async function countUnreadMessages(
  userId: string,
  familyId: string,
): Promise<number> {
  /*
   * Guarded even though every current caller is already inside a membership
   * check. Without it this counts the messages in any family id handed to it,
   * which discloses how active a family you are not in is — small, but it is
   * still an answer nobody outside that family is entitled to.
   */
  await requireMembership(userId, familyId);

  const [mark] = await db
    .select({ lastReadAt: messageReads.lastReadAt })
    .from(messageReads)
    .where(and(eq(messageReads.familyId, familyId), eq(messageReads.userId, userId)))
    .limit(1);

  const conditions = [
    eq(messages.familyId, familyId),
    // Your own messages are never unread to you.
    ne(messages.senderId, userId),
    isNull(messages.deletedAt),
    ...(mark ? [gt(messages.createdAt, mark.lastReadAt)] : []),
  ];

  return db.$count(messages, and(...conditions));
}

/** Unread counts for every family the user belongs to, in one query. */
export async function countUnreadMessagesAllFamilies(userId: string): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(messages)
    .innerJoin(
      familyMembers,
      and(
        eq(familyMembers.familyId, messages.familyId),
        eq(familyMembers.userId, userId),
      ),
    )
    .leftJoin(
      messageReads,
      and(
        eq(messageReads.familyId, messages.familyId),
        eq(messageReads.userId, userId),
      ),
    )
    .where(
      and(
        ne(messages.senderId, userId),
        isNull(messages.deletedAt),
        sql`(${messageReads.lastReadAt} is null or ${messages.createdAt} > ${messageReads.lastReadAt})`,
      ),
    );

  return rows[0]?.count ?? 0;
}

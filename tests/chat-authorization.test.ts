import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { ApiError } from '@/lib/api/errors';
import { db } from '@/lib/db';
import { messages } from '@/lib/db/schema';
import {
  acceptInvitation,
  createFamily,
  createInvitation,
  removeMember,
} from '@/lib/families/service';
import {
  announceTyping,
  countUnreadMessages,
  deleteMessage,
  listMessages,
  markThreadRead,
  sendMessage,
  MAX_VOICE_NOTE_MS,
} from '@/lib/chat/service';
import { listNotifications } from '@/lib/notifications/service';
import { updatePreferences } from '@/lib/notifications/preferences';
import { closeDatabase, createUser, resetDatabase, type TestUser } from './helpers/factories';

async function expectApiError(promise: Promise<unknown>, status: number) {
  try {
    await promise;
  } catch (error) {
    expect(error, `expected an ApiError, got ${String(error)}`).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(status);
    return;
  }
  throw new Error(`Expected rejection with ${status}, but the call resolved.`);
}

let owner: TestUser;
let admin: TestUser;
let member: TestUser;
let outsider: TestUser;
let familyId: string;

beforeEach(async () => {
  await resetDatabase();
  owner = await createUser('Ama Owner');
  admin = await createUser('Yaw Admin');
  member = await createUser('Kofi Member');
  outsider = await createUser('Stranger Danger');

  const family = await createFamily(owner.id, 'The Boatengs');
  familyId = family.id;

  for (const [user, role] of [
    [admin, 'admin'],
    [member, 'member'],
  ] as const) {
    const invite = await createInvitation(owner.id, familyId, { role, expiresInHours: 24 });
    await acceptInvitation(user.id, invite.code);
  }
});

afterAll(async () => {
  await closeDatabase();
});

/* ========================================================================== */

describe('sending', () => {
  it('refuses a non-member', async () => {
    await expectApiError(sendMessage(outsider.id, familyId, 'let me in'), 404);
  });

  it('refuses a removed member', async () => {
    await sendMessage(member.id, familyId, 'still here');
    await removeMember(owner.id, familyId, member.id);

    await expectApiError(sendMessage(member.id, familyId, 'am I?'), 404);
  });

  it('rejects an empty message', async () => {
    await expectApiError(sendMessage(member.id, familyId, '   '), 400);
  });

  it('rejects an over-long message', async () => {
    await expectApiError(sendMessage(member.id, familyId, 'x'.repeat(2001)), 400);
  });

  it('trims surrounding whitespace', async () => {
    const sent = await sendMessage(member.id, familyId, '  hello  ');
    expect(sent.content).toBe('hello');
  });
});

describe('reading', () => {
  it('refuses a non-member', async () => {
    await sendMessage(member.id, familyId, 'family business');
    await expectApiError(listMessages(outsider.id, familyId), 404);
  });

  it('cuts a removed member off from history', async () => {
    await sendMessage(owner.id, familyId, 'family business');
    await removeMember(owner.id, familyId, member.id);

    await expectApiError(listMessages(member.id, familyId), 404);
  });

  it('never leaks messages across families', async () => {
    await sendMessage(member.id, familyId, 'ours');

    const other = await createFamily(outsider.id, 'Other Family');
    await sendMessage(outsider.id, other.id, 'theirs');

    const ours = await listMessages(owner.id, familyId);
    const theirs = await listMessages(outsider.id, other.id);

    expect(ours.map((m) => m.content)).toEqual(['ours']);
    expect(theirs.map((m) => m.content)).toEqual(['theirs']);
  });
});

describe('deleting', () => {
  it('lets a sender delete their own message', async () => {
    const sent = await sendMessage(member.id, familyId, 'oops');
    await deleteMessage(member.id, familyId, sent.id);

    const [row] = await db
      .select({ deletedAt: messages.deletedAt })
      .from(messages)
      .where(eq(messages.id, sent.id));

    expect(row?.deletedAt).not.toBeNull();
  });

  it('refuses a peer member deleting somebody else’s message', async () => {
    const sent = await sendMessage(owner.id, familyId, 'mine');
    await expectApiError(deleteMessage(member.id, familyId, sent.id), 403);
  });

  it('lets an admin moderate anyone’s message', async () => {
    const sent = await sendMessage(member.id, familyId, 'something unkind');
    await expectApiError(deleteMessage(outsider.id, familyId, sent.id), 404);

    await deleteMessage(admin.id, familyId, sent.id);

    const [row] = await db
      .select({ deletedAt: messages.deletedAt })
      .from(messages)
      .where(eq(messages.id, sent.id));

    expect(row?.deletedAt).not.toBeNull();
  });

  it('keeps the row but withholds the content', async () => {
    const sent = await sendMessage(member.id, familyId, 'secret text');
    await deleteMessage(member.id, familyId, sent.id);

    const listed = await listMessages(owner.id, familyId);
    const deleted = listed.find((m) => m.id === sent.id);

    // A tombstone keeps the thread honest that something was there, without
    // handing back what it said.
    expect(deleted).toBeDefined();
    expect(deleted?.deleted).toBe(true);
    expect(deleted?.content).toBe('');
  });

  it('refuses deleting a message from another family', async () => {
    const sent = await sendMessage(member.id, familyId, 'ours');
    const other = await createFamily(outsider.id, 'Other Family');

    await expectApiError(deleteMessage(outsider.id, other.id, sent.id), 404);
  });

  it('refuses deleting an already-deleted message', async () => {
    const sent = await sendMessage(member.id, familyId, 'oops');
    await deleteMessage(member.id, familyId, sent.id);

    await expectApiError(deleteMessage(member.id, familyId, sent.id), 404);
  });
});

describe('unread counts', () => {
  it('does not count your own messages', async () => {
    await sendMessage(member.id, familyId, 'hello');
    expect(await countUnreadMessages(member.id, familyId)).toBe(0);
  });

  it('counts messages from others', async () => {
    await sendMessage(member.id, familyId, 'one');
    await sendMessage(admin.id, familyId, 'two');

    expect(await countUnreadMessages(owner.id, familyId)).toBe(2);
  });

  it('clears once the thread is marked read', async () => {
    await sendMessage(member.id, familyId, 'hello');
    await markThreadRead(owner.id, familyId);

    expect(await countUnreadMessages(owner.id, familyId)).toBe(0);
  });

  it('does not count deleted messages', async () => {
    const sent = await sendMessage(member.id, familyId, 'oops');
    await deleteMessage(member.id, familyId, sent.id);

    expect(await countUnreadMessages(owner.id, familyId)).toBe(0);
  });

  it('never moves the read mark backwards', async () => {
    await sendMessage(member.id, familyId, 'first');
    await markThreadRead(owner.id, familyId);

    // An out-of-order request must not resurrect messages already seen.
    await markThreadRead(owner.id, familyId, new Date(Date.now() - 60 * 60 * 1000));

    expect(await countUnreadMessages(owner.id, familyId)).toBe(0);
  });

  it('counts only the family in question', async () => {
    await sendMessage(member.id, familyId, 'ours');

    const other = await createFamily(outsider.id, 'Other Family');
    expect(await countUnreadMessages(outsider.id, other.id)).toBe(0);
  });

  it('refuses to count for a family the caller is not in', async () => {
    await sendMessage(member.id, familyId, 'ours');

    // Otherwise this discloses how active a family you are not in is — small,
    // but not an answer an outsider is entitled to.
    await expectApiError(countUnreadMessages(outsider.id, familyId), 404);
  });
});

/* ========================================================================== */

/**
 * Chat notifications.
 *
 * `notification_preferences.chat_messages` shipped with the settings screen and
 * governed nothing: sending a message published an in-app realtime hint and
 * stopped there. With the app closed there was no way to learn a message had
 * arrived, and on a phone there was no badge either.
 */
describe('notifying', () => {
  it('tells the rest of the family, but not the sender', async () => {
    await sendMessage(member.id, familyId, 'dinner at 7');

    const forOwner = await listNotifications(owner.id, familyId);
    const forAdmin = await listNotifications(admin.id, familyId);
    const forSender = await listNotifications(member.id, familyId);

    expect(forOwner).toHaveLength(1);
    expect(forOwner[0]?.type).toBe('NEW_MESSAGE');
    expect(forOwner[0]?.title).toBe('Kofi Member');
    expect(forOwner[0]?.message).toBe('dinner at 7');

    expect(forAdmin).toHaveLength(1);
    expect(forSender, 'the sender never notifies themselves').toHaveLength(0);
  });

  it('respects a member who turned chat notifications off', async () => {
    await updatePreferences(admin.id, familyId, { chatMessages: false });

    await sendMessage(member.id, familyId, 'still going ahead');

    expect(await listNotifications(admin.id, familyId)).toHaveLength(0);
    expect(await listNotifications(owner.id, familyId)).toHaveLength(1);
  });

  it('truncates a long message into a preview and collapses whitespace', async () => {
    await sendMessage(member.id, familyId, `line one\n\n   line   two ${'x'.repeat(200)}`);

    const [notification] = await listNotifications(owner.id, familyId);

    expect(notification?.message.length).toBeLessThanOrEqual(120);
    expect(notification?.message).toContain('line one line two');
    expect(notification?.message.endsWith('…')).toBe(true);
  });

  it('carries the family and message ids so a tap can open the thread', async () => {
    const sent = await sendMessage(member.id, familyId, 'open me');
    const [notification] = await listNotifications(owner.id, familyId);

    expect(notification?.data).toMatchObject({
      familyId,
      messageId: String(sent.id),
      actorId: member.id,
    });
  });
})

/* ========================================================================== */

/**
 * Voice notes.
 *
 * A recording is still a message: it takes a row in the same thread, keeps the
 * same ordering, and carries text for the notification preview and for anyone
 * who cannot play audio. What it must not do is survive deletion — a deleted
 * voice note that still has a playable URL is not deleted.
 */
describe('voice notes', () => {
  const audio = { url: 'https://blob.example/voice/abc.webm', durationMs: 4200 };

  it('stores the recording alongside the thread', async () => {
    const sent = await sendMessage(member.id, familyId, '', audio);

    expect(sent.audioUrl).toBe(audio.url);
    expect(sent.audioDurationMs).toBe(4200);

    const [listed] = await listMessages(owner.id, familyId);
    expect(listed?.audioUrl).toBe(audio.url);
    expect(listed?.audioDurationMs).toBe(4200);
  });

  it('gives it readable text even though nothing was typed', async () => {
    const sent = await sendMessage(member.id, familyId, '', audio);

    expect(sent.content.length).toBeGreaterThan(0);
  });

  it('notifies the family like any other message', async () => {
    await sendMessage(member.id, familyId, '', audio);

    const [notification] = await listNotifications(owner.id, familyId);
    expect(notification?.type).toBe('NEW_MESSAGE');
    expect(notification?.message.length).toBeGreaterThan(0);
  });

  it('takes no recording longer than the cap', async () => {
    await expectApiError(
      sendMessage(member.id, familyId, '', { ...audio, durationMs: MAX_VOICE_NOTE_MS + 1 }),
      400,
    );
    await expectApiError(sendMessage(member.id, familyId, '', { ...audio, durationMs: 0 }), 400);
  });

  it('still refuses an empty message with no recording', async () => {
    await expectApiError(sendMessage(member.id, familyId, '   '), 400);
  });

  it('leaves nothing playable behind once deleted', async () => {
    const sent = await sendMessage(member.id, familyId, '', audio);
    await deleteMessage(member.id, familyId, sent.id);

    const [listed] = await listMessages(owner.id, familyId);
    expect(listed?.deleted).toBe(true);
    expect(listed?.audioUrl, 'a deleted voice note must not stay playable').toBeNull();
    expect(listed?.audioDurationMs).toBeNull();
  });

  it('refuses a non-member', async () => {
    await expectApiError(sendMessage(outsider.id, familyId, '', audio), 404);
  });
});

/* ========================================================================== */

describe('typing hints', () => {
  it('accepts a member', async () => {
    await expect(announceTyping(member.id, familyId)).resolves.toBeUndefined();
  });

  /* The hint carries a name, so it is not for people outside the family. */
  it('refuses a non-member', async () => {
    await expectApiError(announceTyping(outsider.id, familyId), 404);
  });
});

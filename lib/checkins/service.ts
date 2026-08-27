import 'server-only';

import { and, desc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  checkInRequests,
  users,
  type CheckInReplyValue,
  type CheckInRequest,
} from '@/lib/db/schema';
import { requireMembership, requireSameFamily } from '@/lib/permissions/family';
import { Errors } from '@/lib/api/errors';
import { publishEvent } from '@/lib/realtime/publish';
import { displayName, notifyFamily } from '@/lib/notifications/service';

/**
 * Check-ins — "Are you OK?", answered in one tap.
 *
 * The important thing this is *not*: a location request. It asks a person a
 * question and they answer it. Their sharing settings are untouched, and
 * attaching a position to the reply is their choice, made at the moment they
 * reply. That distinction is the whole point — a family that wants
 * reassurance should be able to ask for it without anybody's standing privacy
 * settings changing.
 */

/** An unanswered check-in stops nagging after this long. */
const EXPIRY_MS = 12 * 60 * 60 * 1000;

/** Stops a check-in being used to pester somebody. */
const MIN_INTERVAL_MS = 5 * 60 * 1000;

export interface CheckInView {
  id: string;
  requesterId: string;
  requesterName: string;
  targetId: string;
  targetName: string;
  note: string | null;
  status: CheckInRequest['status'];
  reply: CheckInReplyValue | null;
  replyLatitude: number | null;
  replyLongitude: number | null;
  createdAt: Date;
  respondedAt: Date | null;
}

export async function requestCheckIn(
  requesterId: string,
  familyId: string,
  targetId: string,
  note?: string,
): Promise<CheckInView> {
  if (requesterId === targetId) {
    throw Errors.badRequest('You can’t check in on yourself.');
  }

  await requireSameFamily(requesterId, targetId, familyId);

  /*
   * Rate limited per pair rather than per sender: the harm here is pestering
   * one specific person, and a global limit would let somebody send one to
   * everybody while blocking a legitimate second ask of the same person.
   */
  const [recent] = await db
    .select({ createdAt: checkInRequests.createdAt })
    .from(checkInRequests)
    .where(
      and(
        eq(checkInRequests.requesterId, requesterId),
        eq(checkInRequests.targetId, targetId),
        eq(checkInRequests.status, 'pending'),
      ),
    )
    .orderBy(desc(checkInRequests.createdAt))
    .limit(1);

  if (recent && Date.now() - recent.createdAt.getTime() < MIN_INTERVAL_MS) {
    throw Errors.conflict(
      'You’ve already asked recently. Give them a few minutes to reply.',
    );
  }

  const [created] = await db
    .insert(checkInRequests)
    .values({
      familyId,
      requesterId,
      targetId,
      note: note?.trim() || null,
      expiresAt: new Date(Date.now() + EXPIRY_MS),
    })
    .returning();

  if (!created) throw Errors.internal();

  const requesterName = await displayName(requesterId).catch(() => 'A family member');

  await notifyFamily({
    familyId,
    type: 'FAMILY_INVITE',
    title: `${requesterName} is checking in`,
    message: note?.trim()
      ? `${requesterName} asks: ${note.trim()}`
      : `${requesterName} wants to know if you’re OK.`,
    data: { checkInId: created.id, requesterId },
    // Only the person being asked.
    recipientIds: [targetId],
  });

  await publishEvent(familyId, 'notification');

  return toView(created, requesterName, await displayName(targetId).catch(() => 'They'));
}

/**
 * Answers a check-in.
 *
 * Only the person asked may answer, and a position is attached only if they
 * chose to send one.
 */
export async function respondToCheckIn(
  userId: string,
  familyId: string,
  checkInId: string,
  reply: CheckInReplyValue,
  position?: { latitude: number; longitude: number },
): Promise<CheckInView> {
  await requireMembership(userId, familyId);

  const [updated] = await db
    .update(checkInRequests)
    .set({
      status: 'answered',
      reply,
      replyLatitude: position?.latitude ?? null,
      replyLongitude: position?.longitude ?? null,
      respondedAt: new Date(),
    })
    .where(
      and(
        eq(checkInRequests.id, checkInId),
        eq(checkInRequests.familyId, familyId),
        // Only the person asked can answer, and only once.
        eq(checkInRequests.targetId, userId),
        eq(checkInRequests.status, 'pending'),
      ),
    )
    .returning();

  if (!updated) throw Errors.notFound('That check-in');

  const targetName = await displayName(userId).catch(() => 'A family member');

  await notifyFamily({
    familyId,
    // "need help" is an emergency-shaped answer, so it is delivered as one and
    // cannot be muted by preferences.
    type: reply === 'need_help' ? 'SOS' : 'FAMILY_INVITE',
    title:
      reply === 'need_help' ? `🚨 ${targetName} needs help` : `${targetName} is OK`,
    message:
      reply === 'need_help'
        ? `${targetName} answered a check-in saying they need help.`
        : `${targetName} replied that they're OK.`,
    data: { checkInId, targetId: userId, reply },
    recipientIds: [updated.requesterId],
  });

  await publishEvent(familyId, 'notification');

  const requesterName = await displayName(updated.requesterId).catch(() => 'They');
  return toView(updated, requesterName, targetName);
}

/** Check-ins awaiting this member's answer. */
export async function listPendingForMe(
  userId: string,
  familyId: string,
): Promise<CheckInView[]> {
  await requireMembership(userId, familyId);

  // Retire anything past its window so it stops appearing.
  await db
    .update(checkInRequests)
    .set({ status: 'expired' })
    .where(
      and(
        eq(checkInRequests.targetId, userId),
        eq(checkInRequests.status, 'pending'),
        lt(checkInRequests.expiresAt, new Date()),
      ),
    );

  const rows = await db
    .select({
      request: checkInRequests,
      requesterName: users.name,
    })
    .from(checkInRequests)
    .innerJoin(users, eq(users.id, checkInRequests.requesterId))
    .where(
      and(
        eq(checkInRequests.familyId, familyId),
        eq(checkInRequests.targetId, userId),
        eq(checkInRequests.status, 'pending'),
      ),
    )
    .orderBy(desc(checkInRequests.createdAt))
    .limit(10);

  return rows.map((r) => toView(r.request, r.requesterName, 'You'));
}

/** Recent check-ins this member sent or received. */
export async function listCheckIns(
  userId: string,
  familyId: string,
  limit = 20,
): Promise<CheckInView[]> {
  await requireMembership(userId, familyId);

  const requester = users;

  const rows = await db
    .select({
      request: checkInRequests,
      requesterName: requester.name,
    })
    .from(checkInRequests)
    .innerJoin(requester, eq(requester.id, checkInRequests.requesterId))
    .where(
      and(
        eq(checkInRequests.familyId, familyId),
        // Only conversations this member is part of. A check-in between two
        // other people is between them.
        or(
          eq(checkInRequests.requesterId, userId),
          eq(checkInRequests.targetId, userId),
        ),
      ),
    )
    .orderBy(desc(checkInRequests.createdAt))
    .limit(Math.min(limit, 50));

  const targetNames = new Map<string, string>();
  for (const row of rows) {
    if (!targetNames.has(row.request.targetId)) {
      targetNames.set(
        row.request.targetId,
        await displayName(row.request.targetId).catch(() => 'They'),
      );
    }
  }

  return rows.map((r) =>
    toView(r.request, r.requesterName, targetNames.get(r.request.targetId) ?? 'They'),
  );
}

function toView(
  request: CheckInRequest,
  requesterName: string,
  targetName: string,
): CheckInView {
  return {
    id: request.id,
    requesterId: request.requesterId,
    requesterName,
    targetId: request.targetId,
    targetName,
    note: request.note,
    status: request.status,
    reply: request.reply,
    replyLatitude: request.replyLatitude,
    replyLongitude: request.replyLongitude,
    createdAt: request.createdAt,
    respondedAt: request.respondedAt,
  };
}

/** Housekeeping for anything left pending past its window. */
export async function expireStaleCheckIns(): Promise<number> {
  const expired = await db
    .update(checkInRequests)
    .set({ status: 'expired' })
    .where(
      and(
        eq(checkInRequests.status, 'pending'),
        lt(checkInRequests.expiresAt, new Date()),
        isNull(checkInRequests.respondedAt),
      ),
    )
    .returning({ id: checkInRequests.id });

  return expired.length;
}

export { sql };

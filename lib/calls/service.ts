import 'server-only';

import { and, desc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  callParticipants,
  callSignals,
  calls,
  families,
  familyMembers,
  users,
  type Call,
  type CallKind,
} from '@/lib/db/schema';
import { requireMembership } from '@/lib/permissions/family';
import { ApiError, Errors } from '@/lib/api/errors';
import { publishEvent } from '@/lib/realtime/publish';
import { displayName, notifyFamily } from '@/lib/notifications/service';
import { MAX_CALL_PARTICIPANTS } from './ice';

/**
 * Call coordination.
 *
 * Media never reaches this server — WebRTC carries audio and video directly
 * between browsers. Everything here is bookkeeping: who is ringing whom, who
 * answered, and relaying the SDP and ICE messages the peers need to find each
 * other.
 *
 * That relay is the only reason signalling is persisted. Serverless instances
 * share no memory, so a peer's answer may arrive at a different instance than
 * the one that took the offer; a table is the simplest thing that works
 * everywhere.
 */

/** A ringing call that nobody answers is given up on after this long. */
const RING_TIMEOUT_MS = 45_000;

export interface CallView {
  id: string;
  familyId: string;
  kind: CallKind;
  status: Call['status'];
  initiatorId: string;
  initiatorName: string;
  startedAt: Date;
  participants: { userId: string; name: string; image: string | null; joined: boolean }[];
}

/* -------------------------------------------------------------------------- */
/* Lifecycle                                                                   */
/* -------------------------------------------------------------------------- */

export async function startCall(
  userId: string,
  familyId: string,
  kind: CallKind,
  /**
   * Who to ring. Omitted rings the whole family, which is what the call
   * buttons in the chat and family headers do.
   *
   * Naming people instead makes the call private to them: participation is
   * what makes a call visible, so a call nobody else is a participant of does
   * not appear to the rest of the family at all.
   */
  inviteeIds?: string[],
): Promise<CallView> {
  await requireMembership(userId, familyId);

  // Joining an existing call is better than starting a rival one beside it.
  const existing = await getActiveCall(userId, familyId);
  if (existing) {
    await joinCall(userId, familyId, existing.id);
    return existing;
  }

  const members = await db
    .select({ userId: familyMembers.userId })
    .from(familyMembers)
    .where(eq(familyMembers.familyId, familyId));

  if (members.length < 2) {
    throw Errors.conflict('There is nobody else in this family to call yet.');
  }

  let participantIds = members.map((m) => m.userId);

  if (inviteeIds) {
    const invited = new Set(inviteeIds.filter((id) => id !== userId));

    if (invited.size === 0) {
      throw Errors.badRequest('Choose at least one person to call.');
    }

    // Everyone named must actually be in this family, or a call could be used
    // to probe for user ids that are nothing to do with it.
    const inFamily = new Set(members.map((m) => m.userId));
    for (const id of invited) {
      if (!inFamily.has(id)) throw Errors.notFound('That family member');
    }

    participantIds = [userId, ...invited];

    if (participantIds.length > MAX_CALL_PARTICIPANTS) {
      throw Errors.conflict(
        `FamLink supports up to ${MAX_CALL_PARTICIPANTS} people on a call, including you.`,
      );
    }
  }

  const call = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(calls)
      .values({ familyId, initiatorId: userId, kind, status: 'ringing' })
      .returning();

    if (!created) throw Errors.internal();

    await tx.insert(callParticipants).values(
      participantIds.map((id) => ({
        callId: created.id,
        userId: id,
        // The caller is already in; everyone else is being rung.
        joinedAt: id === userId ? new Date() : null,
      })),
    );

    return created;
  });

  const name = await displayName(userId).catch(() => 'A family member');

  await notifyFamily({
    familyId,
    type: 'FAMILY_INVITE',
    title: `${name} is calling`,
    message: `${name} started a ${kind === 'video' ? 'video' : 'voice'} call.`,
    data: { callId: call.id, kind, actorId: userId },
    // Only the people being rung. A direct call must not announce itself to
    // the rest of the family.
    recipientIds: participantIds.filter((id) => id !== userId),
    exclude: userId,
  });

  await publishEvent(familyId, 'call', { actorName: name });

  // Participants are loaded rather than defaulted: the caller needs to know
  // who is being rung in order to render the call, and an empty list would
  // read as "nobody is on this call".
  return toView(call, userId, name, await loadParticipants(call.id));
}

export async function joinCall(
  userId: string,
  familyId: string,
  callId: string,
): Promise<CallView> {
  await requireMembership(userId, familyId);

  const call = await loadCall(familyId, callId);

  if (call.status === 'ended' || call.status === 'declined') {
    throw Errors.conflict('That call has already ended.');
  }

  /*
   * Being in the family is not enough. A group call lists every member as a
   * participant, so this is transparent there — but a call between two people
   * cannot be joined by a third who happens to know the id.
   */
  const [invited] = await db
    .select({ userId: callParticipants.userId })
    .from(callParticipants)
    .where(and(eq(callParticipants.callId, callId), eq(callParticipants.userId, userId)))
    .limit(1);

  if (!invited) throw Errors.notFound('That call');

  const joined = await db.$count(
    callParticipants,
    and(eq(callParticipants.callId, callId), sql`joined_at is not null and left_at is null`),
  );

  if (joined >= MAX_CALL_PARTICIPANTS) {
    throw Errors.conflict(
      `This call is full. FamLink supports up to ${MAX_CALL_PARTICIPANTS} people at once.`,
    );
  }

  await db.transaction(async (tx) => {
    await tx
      .insert(callParticipants)
      .values({ callId, userId, joinedAt: new Date() })
      .onConflictDoUpdate({
        target: [callParticipants.callId, callParticipants.userId],
        set: { joinedAt: new Date(), leftAt: null },
      });

    // The first answer promotes the call from ringing to active.
    if (call.status === 'ringing' && userId !== call.initiatorId) {
      await tx
        .update(calls)
        .set({ status: 'active', answeredAt: new Date() })
        .where(eq(calls.id, callId));
    }
  });

  await publishEvent(familyId, 'call');

  return (await getCall(userId, familyId, callId))!;
}

/** Leaves a call. The last participant out ends it for everyone. */
export async function leaveCall(
  userId: string,
  familyId: string,
  callId: string,
): Promise<void> {
  await requireMembership(userId, familyId);

  await db
    .update(callParticipants)
    .set({ leftAt: new Date() })
    .where(and(eq(callParticipants.callId, callId), eq(callParticipants.userId, userId)));

  const remaining = await db.$count(
    callParticipants,
    and(eq(callParticipants.callId, callId), sql`joined_at is not null and left_at is null`),
  );

  if (remaining <= 1) {
    /*
     * The call may already have been ended by whoever left just before us, in
     * which case endCall finds nothing to update and reports 404. Leaving a
     * call that has already finished is not an error for the person leaving.
     */
    await endCall(userId, familyId, callId).catch((error) => {
      if (error instanceof ApiError && error.status === 404) return;
      throw error;
    });
  } else {
    await publishEvent(familyId, 'call');
  }
}

/** Declines a ringing call for this member only; others keep ringing. */
export async function declineCall(
  userId: string,
  familyId: string,
  callId: string,
): Promise<void> {
  await requireMembership(userId, familyId);

  await db
    .update(callParticipants)
    .set({ leftAt: new Date() })
    .where(
      and(
        eq(callParticipants.callId, callId),
        eq(callParticipants.userId, userId),
        isNull(callParticipants.joinedAt),
      ),
    );

  const stillRinging = await db.$count(
    callParticipants,
    and(eq(callParticipants.callId, callId), sql`joined_at is null and left_at is null`),
  );

  const answered = await db.$count(
    callParticipants,
    and(eq(callParticipants.callId, callId), sql`joined_at is not null and left_at is null`),
  );

  // Nobody left to answer and nobody in the call: it is over.
  if (stillRinging === 0 && answered <= 1) {
    await db
      .update(calls)
      .set({ status: 'declined', endedAt: new Date() })
      .where(and(eq(calls.id, callId), eq(calls.status, 'ringing')));
  }

  await publishEvent(familyId, 'call');
}

export async function endCall(
  userId: string,
  familyId: string,
  callId: string,
): Promise<void> {
  await requireMembership(userId, familyId);

  const [updated] = await db
    .update(calls)
    .set({ status: 'ended', endedAt: new Date() })
    .where(
      and(
        eq(calls.id, callId),
        eq(calls.familyId, familyId),
        or(eq(calls.status, 'ringing'), eq(calls.status, 'active')),
      ),
    )
    .returning();

  /*
   * No row matched: either the call belongs to another family, or it had
   * already ended. Both are a refusal, and reporting success for a call this
   * caller cannot act on would be a lie — the same failure the SOS-mute path
   * had.
   */
  if (!updated) throw Errors.notFound('That call');

  await db
    .update(callParticipants)
    .set({ leftAt: new Date() })
    .where(and(eq(callParticipants.callId, callId), isNull(callParticipants.leftAt)));

  // Signalling is worthless once the call is over, and it is the only place
  // SDP lingers, so it is cleared rather than left to a sweep.
  await db.delete(callSignals).where(eq(callSignals.callId, callId));

  await publishEvent(familyId, 'call');
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

async function loadCall(familyId: string, callId: string): Promise<Call> {
  const [call] = await db
    .select()
    .from(calls)
    // Scoped by family so a call id from elsewhere resolves to nothing.
    .where(and(eq(calls.id, callId), eq(calls.familyId, familyId)))
    .limit(1);

  if (!call) throw Errors.notFound('That call');
  return call;
}

export async function getCall(
  userId: string,
  familyId: string,
  callId: string,
): Promise<CallView | null> {
  await requireMembership(userId, familyId);

  const call = await loadCall(familyId, callId);
  const name = await displayName(call.initiatorId).catch(() => 'A family member');

  return toView(call, userId, name, await loadParticipants(callId));
}

/**
 * Any call ringing for this member, in any family they belong to.
 *
 * The in-app ring is mounted against one family — whichever is on screen — so
 * a call in another family produced a push notification and nothing else. By
 * the time somebody noticed and switched family the 45-second ring had long
 * since timed out. For an app whose point is reaching people quickly that is
 * the wrong failure.
 *
 * Returns the family alongside the call so the caller can move there before
 * answering.
 */
export async function findCallForUser(
  userId: string,
): Promise<{ familyId: string; familyName: string; call: CallView } | null> {
  const memberships = await db
    .select({ familyId: familyMembers.familyId, familyName: families.name })
    .from(familyMembers)
    .innerJoin(families, eq(families.id, familyMembers.familyId))
    .where(eq(familyMembers.userId, userId));

  for (const { familyId, familyName } of memberships) {
    const call = await getActiveCall(userId, familyId);
    if (call) return { familyId, familyName, call };
  }

  return null;
}

/**
 * The family's current call, if any.
 *
 * Also retires calls that have been ringing too long, so a caller who closed
 * their tab does not leave the family's phone ringing indefinitely.
 */
export async function getActiveCall(
  userId: string,
  familyId: string,
): Promise<CallView | null> {
  await requireMembership(userId, familyId);

  /*
   * Scoped to calls this member is a participant of.
   *
   * A group call adds every member, so everyone still sees it and can join
   * late. A call started with named people adds only them, and that is the
   * whole of what makes it private — nobody else is told it is happening.
   */
  const [call] = await db
    .select()
    .from(calls)
    .innerJoin(callParticipants, eq(callParticipants.callId, calls.id))
    .where(
      and(
        eq(calls.familyId, familyId),
        eq(callParticipants.userId, userId),
        or(eq(calls.status, 'ringing'), eq(calls.status, 'active')),
      ),
    )
    .orderBy(desc(calls.startedAt))
    .limit(1)
    .then((rows) => rows.map((r) => r.calls));

  if (!call) return null;

  if (
    call.status === 'ringing' &&
    Date.now() - call.startedAt.getTime() > RING_TIMEOUT_MS
  ) {
    await db
      .update(calls)
      .set({ status: 'missed', endedAt: new Date() })
      .where(and(eq(calls.id, call.id), eq(calls.status, 'ringing')));
    await db.delete(callSignals).where(eq(callSignals.callId, call.id));
    return null;
  }

  const name = await displayName(call.initiatorId).catch(() => 'A family member');
  return toView(call, userId, name, await loadParticipants(call.id));
}

async function loadParticipants(callId: string) {
  return db
    .select({
      userId: callParticipants.userId,
      name: users.name,
      image: users.image,
      joinedAt: callParticipants.joinedAt,
      leftAt: callParticipants.leftAt,
    })
    .from(callParticipants)
    .innerJoin(users, eq(users.id, callParticipants.userId))
    .where(eq(callParticipants.callId, callId));
}

function toView(
  call: Call,
  _viewerId: string,
  initiatorName: string,
  participants: Awaited<ReturnType<typeof loadParticipants>> = [],
): CallView {
  return {
    id: call.id,
    familyId: call.familyId,
    kind: call.kind,
    status: call.status,
    initiatorId: call.initiatorId,
    initiatorName,
    startedAt: call.startedAt,
    participants: participants.map((p) => ({
      userId: p.userId,
      name: p.name,
      image: p.image,
      joined: p.joinedAt !== null && p.leftAt === null,
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* Signalling                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Records a signalling message for delivery to a peer.
 *
 * Membership in the call is checked, not merely membership of the family: a
 * family member who is not on the call has no business injecting SDP into it.
 */
export async function sendSignal(
  userId: string,
  familyId: string,
  callId: string,
  input: { toUserId?: string | undefined; kind: string; payload: Record<string, unknown> },
): Promise<void> {
  await requireMembership(userId, familyId);
  await loadCall(familyId, callId);

  const [participant] = await db
    .select({ userId: callParticipants.userId })
    .from(callParticipants)
    .where(
      and(eq(callParticipants.callId, callId), eq(callParticipants.userId, userId)),
    )
    .limit(1);

  if (!participant) throw Errors.forbidden('You are not part of this call.');

  await db.insert(callSignals).values({
    callId,
    fromUserId: userId,
    toUserId: input.toUserId ?? null,
    kind: input.kind,
    payload: input.payload,
  });

  await publishEvent(familyId, 'call');
}

/** Signals addressed to this member (or broadcast) since a cursor. */
export async function pollSignals(
  userId: string,
  familyId: string,
  callId: string,
  afterId: number,
): Promise<{ id: number; fromUserId: string; kind: string; payload: Record<string, unknown> }[]> {
  await requireMembership(userId, familyId);
  await loadCall(familyId, callId);

  return db
    .select({
      id: callSignals.id,
      fromUserId: callSignals.fromUserId,
      kind: callSignals.kind,
      payload: callSignals.payload,
    })
    .from(callSignals)
    .where(
      and(
        eq(callSignals.callId, callId),
        gt(callSignals.id, afterId),
        // Addressed to me, or broadcast to everyone.
        or(eq(callSignals.toUserId, userId), isNull(callSignals.toUserId)),
        // Never echo a member's own messages back to them.
        sql`${callSignals.fromUserId} <> ${userId}`,
      ),
    )
    .orderBy(callSignals.id)
    .limit(100);
}

/** Recent call history for the family. */
export async function listRecentCalls(userId: string, familyId: string, limit = 20) {
  await requireMembership(userId, familyId);

  return db
    .select({
      id: calls.id,
      kind: calls.kind,
      status: calls.status,
      initiatorId: calls.initiatorId,
      initiatorName: users.name,
      startedAt: calls.startedAt,
      /*
       * Talk time is measured from the answer, not from the ring. A call that
       * rang for forty seconds and lasted two minutes is a two-minute call;
       * counting the ringing would quietly inflate every entry.
       */
      answeredAt: calls.answeredAt,
      endedAt: calls.endedAt,
    })
    .from(calls)
    .innerJoin(users, eq(users.id, calls.initiatorId))
    .where(
      and(
        eq(calls.familyId, familyId),
        inArray(calls.status, ['ended', 'missed', 'declined']),
      ),
    )
    .orderBy(desc(calls.startedAt))
    .limit(Math.min(limit, 50));
}

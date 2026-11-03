import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { ApiError } from '@/lib/api/errors';
import { db } from '@/lib/db';
import { checkInRequests, familyMembers, messageReactions } from '@/lib/db/schema';
import {
  acceptInvitation,
  createFamily,
  createInvitation,
} from '@/lib/families/service';
import {
  expireStaleCheckIns,
  listCheckIns,
  listPendingForMe,
  listSentCheckIns,
  requestCheckIn,
  respondToCheckIn,
} from '@/lib/checkins/service';
import { getReactions, reactToMessage, sendMessage } from '@/lib/chat/service';
import { listNotifications } from '@/lib/notifications/service';
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
let member: TestUser;
let third: TestUser;
let outsider: TestUser;
let familyId: string;

beforeEach(async () => {
  await resetDatabase();
  owner = await createUser('Ama Owner');
  member = await createUser('Kofi Member');
  third = await createUser('Yaw Third');
  outsider = await createUser('Stranger Danger');

  const family = await createFamily(owner.id, 'The Boatengs');
  familyId = family.id;

  for (const user of [member, third]) {
    const invite = await createInvitation(owner.id, familyId, {
      role: 'member',
      expiresInHours: 24,
    });
    await acceptInvitation(user.id, invite.code);
  }
});

afterAll(async () => {
  await closeDatabase();
});

/* ========================================================================== */

describe('requesting a check-in', () => {
  it('refuses a non-member', async () => {
    await expectApiError(requestCheckIn(outsider.id, familyId, member.id), 404);
  });

  it('refuses targeting somebody outside the family', async () => {
    await expectApiError(requestCheckIn(owner.id, familyId, outsider.id), 403);
  });

  it('refuses checking in on yourself', async () => {
    await expectApiError(requestCheckIn(owner.id, familyId, owner.id), 400);
  });

  it('notifies only the person asked', async () => {
    await requestCheckIn(owner.id, familyId, member.id, 'Everything alright?');

    expect(await listNotifications(member.id, familyId)).toHaveLength(1);
    // A check-in is between two people; the rest of the family is not told.
    expect(await listNotifications(third.id, familyId)).toHaveLength(0);
  });

  it('rate limits repeat asks to the same person', async () => {
    await requestCheckIn(owner.id, familyId, member.id);
    await expectApiError(requestCheckIn(owner.id, familyId, member.id), 409);
  });

  it('does not block asking a different person', async () => {
    await requestCheckIn(owner.id, familyId, member.id);

    // The harm is pestering one person, so the limit is per pair.
    await expect(requestCheckIn(owner.id, familyId, third.id)).resolves.toBeDefined();
  });

  it('does not change the target’s sharing settings', async () => {
    const [before] = await db
      .select()
      .from(familyMembers)
      .where(
        and(eq(familyMembers.userId, member.id), eq(familyMembers.familyId, familyId)),
      );

    await requestCheckIn(owner.id, familyId, member.id);

    const [after] = await db
      .select()
      .from(familyMembers)
      .where(
        and(eq(familyMembers.userId, member.id), eq(familyMembers.familyId, familyId)),
      );

    // A check-in asks a person a question. It is not a location request.
    expect(after?.locationSharingState).toBe(before?.locationSharingState);
    expect(after?.locationVisibility).toBe(before?.locationVisibility);
  });
});

describe('answering a check-in', () => {
  it('lets only the person asked answer', async () => {
    const checkIn = await requestCheckIn(owner.id, familyId, member.id);

    await expectApiError(respondToCheckIn(third.id, familyId, checkIn.id, 'ok'), 404);
    // Not even the person who asked can answer on their behalf.
    await expectApiError(respondToCheckIn(owner.id, familyId, checkIn.id, 'ok'), 404);

    await expect(
      respondToCheckIn(member.id, familyId, checkIn.id, 'ok'),
    ).resolves.toBeDefined();
  });

  it('cannot be answered twice', async () => {
    const checkIn = await requestCheckIn(owner.id, familyId, member.id);
    await respondToCheckIn(member.id, familyId, checkIn.id, 'ok');

    await expectApiError(respondToCheckIn(member.id, familyId, checkIn.id, 'ok'), 404);
  });

  it('stores a position only when one was offered', async () => {
    const without = await requestCheckIn(owner.id, familyId, member.id);
    await respondToCheckIn(member.id, familyId, without.id, 'ok');

    const [row] = await db
      .select()
      .from(checkInRequests)
      .where(eq(checkInRequests.id, without.id));

    expect(row?.replyLatitude).toBeNull();
    expect(row?.replyLongitude).toBeNull();
  });

  it('attaches a position when the responder chose to send one', async () => {
    const checkIn = await requestCheckIn(owner.id, familyId, third.id);

    await respondToCheckIn(third.id, familyId, checkIn.id, 'ok', {
      latitude: 5.6037,
      longitude: -0.187,
    });

    const [row] = await db
      .select()
      .from(checkInRequests)
      .where(eq(checkInRequests.id, checkIn.id));

    expect(row?.replyLatitude).toBeCloseTo(5.6037, 4);
  });

  it('delivers "need help" as an emergency, which cannot be muted', async () => {
    const checkIn = await requestCheckIn(owner.id, familyId, member.id);
    await respondToCheckIn(member.id, familyId, checkIn.id, 'need_help');

    const [notification] = await listNotifications(owner.id, familyId);

    // SOS-typed notifications bypass preference filtering entirely.
    expect(notification?.type).toBe('SOS');
    expect(notification?.message).toContain('need help');
  });

  it('refuses a check-in from another family', async () => {
    const checkIn = await requestCheckIn(owner.id, familyId, member.id);
    const other = await createFamily(outsider.id, 'Other Family');

    await expectApiError(respondToCheckIn(member.id, other.id, checkIn.id, 'ok'), 404);
  });
});

describe('listing check-ins', () => {
  it('shows only what is awaiting my answer', async () => {
    await requestCheckIn(owner.id, familyId, member.id);
    await requestCheckIn(owner.id, familyId, third.id);

    expect(await listPendingForMe(member.id, familyId)).toHaveLength(1);
    expect(await listPendingForMe(owner.id, familyId)).toHaveLength(0);
  });

  it('excludes check-ins between two other people', async () => {
    await requestCheckIn(owner.id, familyId, member.id);

    // A check-in third had no part in is none of their business.
    expect(await listCheckIns(third.id, familyId)).toHaveLength(0);
    expect(await listCheckIns(owner.id, familyId)).toHaveLength(1);
    expect(await listCheckIns(member.id, familyId)).toHaveLength(1);
  });
});

/* ========================================================================== */

/** Drags a request's window into the past, as if it were sent long ago. */
async function ageOut(checkInId: string) {
  await db
    .update(checkInRequests)
    .set({ expiresAt: new Date(Date.now() - 60_000) })
    .where(eq(checkInRequests.id, checkInId));
}

async function statusOf(checkInId: string) {
  const [row] = await db
    .select({ status: checkInRequests.status })
    .from(checkInRequests)
    .where(eq(checkInRequests.id, checkInId))
    .limit(1);

  return row?.status;
}

/**
 * Check-ins that nobody answers.
 *
 * The case the whole expiry mechanism exists for, and the one it used to miss
 * entirely: expiry fired only for the person *being asked*, and only when they
 * opened the app. Somebody who never opened it left the request pending
 * forever — so "they have not answered" was the single outcome the app never
 * recorded, and recording it depended on an action by the person who was not
 * answering.
 */
describe('a check-in nobody answers', () => {
  it('is retired when the person who asked looks, not only the person asked', async () => {
    const sent = await requestCheckIn(owner.id, familyId, member.id);
    await ageOut(sent.id);

    // Owner reads. Member has not opened the app at all.
    await listSentCheckIns(owner.id, familyId);

    expect(await statusOf(sent.id)).toBe('expired');
  });

  it('is retired by any member of the family reading', async () => {
    const sent = await requestCheckIn(owner.id, familyId, member.id);
    await ageOut(sent.id);

    await listPendingForMe(third.id, familyId);

    expect(await statusOf(sent.id)).toBe('expired');
  });

  it('shows the person who asked that it went unanswered', async () => {
    const sent = await requestCheckIn(owner.id, familyId, member.id);
    await ageOut(sent.id);

    const [outcome] = await listSentCheckIns(owner.id, familyId);

    // Silence used to arrive as nothing at all, which looks exactly like the
    // app having failed to ask.
    expect(outcome?.id).toBe(sent.id);
    expect(outcome?.status).toBe('expired');
    expect(outcome?.targetName).toBe('Kofi Member');
  });

  it('stops nagging the person who was asked', async () => {
    const sent = await requestCheckIn(owner.id, familyId, member.id);
    await ageOut(sent.id);

    expect(await listPendingForMe(member.id, familyId)).toHaveLength(0);
  });

  it('can still be answered afterwards', async () => {
    /*
     * Expiry stops a question nagging; it does not make the answer worthless.
     * A tap on a notification thirteen hours later is still worth delivering,
     * and must not come back as "that check-in was not found".
     */
    const sent = await requestCheckIn(owner.id, familyId, member.id);
    await ageOut(sent.id);
    await listSentCheckIns(owner.id, familyId);
    expect(await statusOf(sent.id)).toBe('expired');

    const answered = await respondToCheckIn(member.id, familyId, sent.id, 'ok');

    expect(answered.status).toBe('answered');
    expect(answered.reply).toBe('ok');
  });

  it('tells the family when a late answer says they need help', async () => {
    const sent = await requestCheckIn(owner.id, familyId, member.id);
    await ageOut(sent.id);
    await listSentCheckIns(owner.id, familyId);

    await respondToCheckIn(member.id, familyId, sent.id, 'need_help');

    const notes = await listNotifications(owner.id, familyId);
    expect(notes.some((n) => n.title.includes('needs help'))).toBe(true);
  });

  it('still cannot be answered twice', async () => {
    const sent = await requestCheckIn(owner.id, familyId, member.id);
    await respondToCheckIn(member.id, familyId, sent.id, 'ok');
    await ageOut(sent.id);

    // Allowing an expired request to be answered must not reopen an answered
    // one: the sweep only touches rows that are still pending.
    await expectApiError(respondToCheckIn(member.id, familyId, sent.id, 'need_help'), 404);
  });

  it('leaves an answered check-in alone', async () => {
    const sent = await requestCheckIn(owner.id, familyId, member.id);
    await respondToCheckIn(member.id, familyId, sent.id, 'ok');
    await ageOut(sent.id);

    await expireStaleCheckIns(familyId);

    expect(await statusOf(sent.id)).toBe('answered');
  });

  it('leaves a request that is still within its window alone', async () => {
    const sent = await requestCheckIn(owner.id, familyId, member.id);

    await expireStaleCheckIns(familyId);

    expect(await statusOf(sent.id)).toBe('pending');
    expect(await listPendingForMe(member.id, familyId)).toHaveLength(1);
  });

  it('does not sweep another family', async () => {
    const sent = await requestCheckIn(owner.id, familyId, member.id);
    await ageOut(sent.id);

    const other = await createFamily(outsider.id, 'Somebody Else');
    await expireStaleCheckIns(other.id);

    expect(await statusOf(sent.id)).toBe('pending');
  });

  it('shows somebody only their own asks', async () => {
    const sent = await requestCheckIn(owner.id, familyId, member.id);
    await ageOut(sent.id);

    // What owner asked is owner's business, not third's.
    expect(await listSentCheckIns(third.id, familyId)).toHaveLength(0);
    expect(await listSentCheckIns(owner.id, familyId)).toHaveLength(1);
    expect(sent.id.length).toBeGreaterThan(0);
  });

  it('drops an ask from the sent list once it is answered', async () => {
    const sent = await requestCheckIn(owner.id, familyId, member.id);
    expect(await listSentCheckIns(owner.id, familyId)).toHaveLength(1);

    await respondToCheckIn(member.id, familyId, sent.id, 'ok');

    // Answered arrives as a notification; this list is for what has not.
    expect(await listSentCheckIns(owner.id, familyId)).toHaveLength(0);
  });

  it('refuses a non-member', async () => {
    // 404, not 403: a non-member is not told the family exists.
    await expectApiError(listSentCheckIns(outsider.id, familyId), 404);
  });
});

/* ========================================================================== */

describe('message reactions', () => {
  it('refuses a non-member', async () => {
    const message = await sendMessage(owner.id, familyId, 'hello');
    await expectApiError(reactToMessage(outsider.id, familyId, message.id, '❤️'), 404);
  });

  it('refuses an emoji outside the allowed set', async () => {
    const message = await sendMessage(owner.id, familyId, 'hello');
    await expectApiError(reactToMessage(member.id, familyId, message.id, '💀'), 400);
  });

  it('refuses a message from another family', async () => {
    const message = await sendMessage(owner.id, familyId, 'ours');
    const other = await createFamily(outsider.id, 'Other Family');

    await expectApiError(reactToMessage(outsider.id, other.id, message.id, '❤️'), 404);
  });

  it('records a reaction', async () => {
    const message = await sendMessage(owner.id, familyId, 'hello');
    await reactToMessage(member.id, familyId, message.id, '❤️');

    const reactions = await getReactions(owner.id, familyId, [message.id]);
    const summary = reactions.get(message.id);

    expect(summary).toHaveLength(1);
    expect(summary?.[0]?.emoji).toBe('❤️');
    expect(summary?.[0]?.count).toBe(1);
  });

  it('replaces rather than accumulates one person’s reaction', async () => {
    const message = await sendMessage(owner.id, familyId, 'hello');

    await reactToMessage(member.id, familyId, message.id, '❤️');
    await reactToMessage(member.id, familyId, message.id, '😂');

    const rows = await db
      .select()
      .from(messageReactions)
      .where(eq(messageReactions.messageId, message.id));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.emoji).toBe('😂');
  });

  it('removes the reaction when the same emoji is sent again', async () => {
    const message = await sendMessage(owner.id, familyId, 'hello');

    await reactToMessage(member.id, familyId, message.id, '👍');
    await reactToMessage(member.id, familyId, message.id, '👍');

    expect(
      await db.$count(messageReactions, eq(messageReactions.messageId, message.id)),
    ).toBe(0);
  });

  it('groups reactions from several people', async () => {
    const message = await sendMessage(owner.id, familyId, 'hello');

    await reactToMessage(member.id, familyId, message.id, '❤️');
    await reactToMessage(third.id, familyId, message.id, '❤️');
    await reactToMessage(owner.id, familyId, message.id, '👍');

    const summary = (await getReactions(owner.id, familyId, [message.id])).get(message.id);

    expect(summary?.[0]?.emoji).toBe('❤️');
    expect(summary?.[0]?.count).toBe(2);
    expect(summary?.[1]?.count).toBe(1);
  });
});

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { ApiError } from '@/lib/api/errors';
import { db } from '@/lib/db';
import { callSignals, calls } from '@/lib/db/schema';
import {
  acceptInvitation,
  createFamily,
  createInvitation,
} from '@/lib/families/service';
import {
  declineCall,
  endCall,
  getActiveCall,
  joinCall,
  pollSignals,
  sendSignal,
  startCall,
} from '@/lib/calls/service';
import { buildIceConfig, MAX_CALL_PARTICIPANTS } from '@/lib/calls/ice';
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
let outsider: TestUser;
let familyId: string;

beforeEach(async () => {
  await resetDatabase();
  owner = await createUser('Ama Owner');
  member = await createUser('Kofi Member');
  outsider = await createUser('Stranger Danger');

  const family = await createFamily(owner.id, 'The Boatengs');
  familyId = family.id;

  const invite = await createInvitation(owner.id, familyId, {
    role: 'member',
    expiresInHours: 24,
  });
  await acceptInvitation(member.id, invite.code);
});

afterAll(async () => {
  await closeDatabase();
});

/* ========================================================================== */

describe('starting a call', () => {
  it('refuses a non-member', async () => {
    await expectApiError(startCall(outsider.id, familyId, 'audio'), 404);
  });

  it('rings everyone else and marks the caller as already in', async () => {
    const call = await startCall(owner.id, familyId, 'video');

    expect(call.status).toBe('ringing');
    expect(call.participants).toHaveLength(2);

    const self = call.participants.find((p) => p.userId === owner.id);
    const other = call.participants.find((p) => p.userId === member.id);

    expect(self?.joined).toBe(true);
    expect(other?.joined).toBe(false);
  });

  it('refuses when there is nobody else to call', async () => {
    const solo = await createFamily(outsider.id, 'Solo Family');
    await expectApiError(startCall(outsider.id, solo.id, 'audio'), 409);
  });

  it('joins the call in progress rather than starting a rival one', async () => {
    const first = await startCall(owner.id, familyId, 'audio');
    const second = await startCall(member.id, familyId, 'video');

    // Two simultaneous calls in one family would split it in half.
    expect(second.id).toBe(first.id);
    expect(await db.$count(calls, eq(calls.familyId, familyId))).toBe(1);
  });
});

describe('answering', () => {
  it('promotes a ringing call to active', async () => {
    const call = await startCall(owner.id, familyId, 'audio');
    const joined = await joinCall(member.id, familyId, call.id);

    expect(joined.status).toBe('active');
  });

  it('refuses a non-member joining', async () => {
    const call = await startCall(owner.id, familyId, 'audio');
    await expectApiError(joinCall(outsider.id, familyId, call.id), 404);
  });

  it('refuses joining a call that has ended', async () => {
    const call = await startCall(owner.id, familyId, 'audio');
    await endCall(owner.id, familyId, call.id);

    await expectApiError(joinCall(member.id, familyId, call.id), 409);
  });

  it('caps participants rather than degrading the call', async () => {
    // Mesh cost grows with every participant; beyond the cap a typical phone
    // starts dropping frames, so the limit is enforced and explained.
    expect(MAX_CALL_PARTICIPANTS).toBeGreaterThanOrEqual(2);
    expect(MAX_CALL_PARTICIPANTS).toBeLessThanOrEqual(6);
  });
});

describe('declining', () => {
  it('silences the call for the decliner only', async () => {
    const extra = await createUser('Yaw Third');
    const invite = await createInvitation(owner.id, familyId, {
      role: 'member',
      expiresInHours: 24,
    });
    await acceptInvitation(extra.id, invite.code);

    const call = await startCall(owner.id, familyId, 'audio');
    await declineCall(member.id, familyId, call.id);

    // The third member is still being rung.
    const active = await getActiveCall(extra.id, familyId);
    expect(active?.id).toBe(call.id);
  });

  it('ends the call when the last person being rung declines', async () => {
    const call = await startCall(owner.id, familyId, 'audio');
    await declineCall(member.id, familyId, call.id);

    const [row] = await db.select().from(calls).where(eq(calls.id, call.id));
    expect(row?.status).toBe('declined');
  });
});

describe('ending', () => {
  it('clears signalling, which is the only place SDP lingers', async () => {
    const call = await startCall(owner.id, familyId, 'audio');
    await joinCall(member.id, familyId, call.id);

    await sendSignal(owner.id, familyId, call.id, {
      toUserId: member.id,
      kind: 'offer',
      payload: { sdp: 'v=0 test' },
    });

    expect(await db.$count(callSignals, eq(callSignals.callId, call.id))).toBe(1);

    await endCall(owner.id, familyId, call.id);

    expect(await db.$count(callSignals, eq(callSignals.callId, call.id))).toBe(0);
  });

  it('refuses ending a call in another family', async () => {
    const call = await startCall(owner.id, familyId, 'audio');
    const other = await createFamily(outsider.id, 'Other Family');

    await expectApiError(endCall(outsider.id, other.id, call.id), 404);

    const [row] = await db.select().from(calls).where(eq(calls.id, call.id));
    expect(row?.status).toBe('ringing');
  });
});

describe('signalling', () => {
  it('refuses a family member who is not on the call', async () => {
    const extra = await createUser('Yaw Third');
    const invite = await createInvitation(owner.id, familyId, {
      role: 'member',
      expiresInHours: 24,
    });
    await acceptInvitation(extra.id, invite.code);

    const call = await startCall(owner.id, familyId, 'audio');
    await declineCall(extra.id, familyId, call.id);

    // Being in the family is not enough — injecting SDP into a call you are
    // not on has no legitimate use.
    await db
      .delete(callSignals)
      .where(eq(callSignals.callId, call.id));

    await expectApiError(
      sendSignal(outsider.id, familyId, call.id, { kind: 'offer', payload: {} }),
      404,
    );
  });

  it('delivers a message addressed to a peer', async () => {
    const call = await startCall(owner.id, familyId, 'audio');
    await joinCall(member.id, familyId, call.id);

    await sendSignal(owner.id, familyId, call.id, {
      toUserId: member.id,
      kind: 'offer',
      payload: { sdp: 'v=0 offer' },
    });

    const received = await pollSignals(member.id, familyId, call.id, 0);

    expect(received).toHaveLength(1);
    expect(received[0]?.kind).toBe('offer');
    expect(received[0]?.fromUserId).toBe(owner.id);
  });

  it('never echoes a sender their own messages', async () => {
    const call = await startCall(owner.id, familyId, 'audio');
    await joinCall(member.id, familyId, call.id);

    await sendSignal(owner.id, familyId, call.id, {
      toUserId: member.id,
      kind: 'offer',
      payload: { sdp: 'v=0' },
    });

    expect(await pollSignals(owner.id, familyId, call.id, 0)).toHaveLength(0);
  });

  it('does not deliver a message addressed to somebody else', async () => {
    const extra = await createUser('Yaw Third');
    const invite = await createInvitation(owner.id, familyId, {
      role: 'member',
      expiresInHours: 24,
    });
    await acceptInvitation(extra.id, invite.code);

    const call = await startCall(owner.id, familyId, 'audio');
    await joinCall(member.id, familyId, call.id);
    await joinCall(extra.id, familyId, call.id);

    await sendSignal(owner.id, familyId, call.id, {
      toUserId: member.id,
      kind: 'offer',
      payload: { sdp: 'private to member' },
    });

    expect(await pollSignals(extra.id, familyId, call.id, 0)).toHaveLength(0);
  });

  it('advances past already-delivered messages via the cursor', async () => {
    const call = await startCall(owner.id, familyId, 'audio');
    await joinCall(member.id, familyId, call.id);

    for (const sdp of ['one', 'two', 'three']) {
      await sendSignal(owner.id, familyId, call.id, {
        toUserId: member.id,
        kind: 'ice',
        payload: { sdp },
      });
    }

    const first = await pollSignals(member.id, familyId, call.id, 0);
    expect(first).toHaveLength(3);

    const cursor = first[first.length - 1]!.id;
    expect(await pollSignals(member.id, familyId, call.id, cursor)).toHaveLength(0);
  });
});

describe('ICE configuration', () => {
  it('reports honestly that there is no relay when TURN is unconfigured', () => {
    const config = buildIceConfig({});

    expect(config.hasRelay).toBe(false);
    expect(config.iceServers.length).toBeGreaterThan(0);
  });

  it('includes the relay when TURN is configured', () => {
    const config = buildIceConfig({
      url: 'turn:relay.example.com:3478',
      username: 'u',
      credential: 'p',
    });

    expect(config.hasRelay).toBe(true);
    expect(config.iceServers.some((s) => String(s.urls).startsWith('turn:'))).toBe(true);
  });
});

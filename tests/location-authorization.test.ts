import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { ApiError } from '@/lib/api/errors';
import { db } from '@/lib/db';
import { currentLocations, familyMembers, locations } from '@/lib/db/schema';
import {
  acceptInvitation,
  createFamily,
  createInvitation,
  removeMember,
} from '@/lib/families/service';
import {
  getFamilyLocations,
  getOwnHistory,
  recordLocation,
  stopSharingAndForget,
  updateSharingSettings,
} from '@/lib/location/service';
import { closeDatabase, createUser, resetDatabase, type TestUser } from './helpers/factories';

/**
 * Location authorization.
 *
 * The product's central promise is that nobody sees your location unless you
 * have said they may. These tests are the evidence for that promise, so they
 * assert on what the *service* returns rather than on what any UI renders.
 */

const ACCRA = { latitude: 5.6037, longitude: -0.187 };
const KUMASI = { latitude: 6.6885, longitude: -1.6244 };

async function expectApiError(promise: Promise<unknown>, status: number, code?: string) {
  try {
    await promise;
  } catch (error) {
    expect(error, `expected an ApiError, got ${String(error)}`).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(status);
    if (code) expect((error as ApiError).code).toBe(code);
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

/** Turns sharing on and posts one fix. */
async function share(user: TestUser, at = ACCRA) {
  await updateSharingSettings(user.id, familyId, { state: 'sharing' });
  await recordLocation(user.id, {
    familyId,
    latitude: at.latitude,
    longitude: at.longitude,
    accuracy: 12,
    recordedAt: new Date(),
  });
}

/* ========================================================================== */

describe('recording a location', () => {
  it('refuses when sharing has never been switched on', async () => {
    // The default is off, so an unmodified member must be rejected.
    await expectApiError(
      recordLocation(member.id, {
        familyId,
        latitude: ACCRA.latitude,
        longitude: ACCRA.longitude,
        recordedAt: new Date(),
      }),
      403,
    );
  });

  it('refuses while sharing is paused', async () => {
    await updateSharingSettings(member.id, familyId, { state: 'sharing' });
    await updateSharingSettings(member.id, familyId, { state: 'paused' });

    // Pausing must stop collection, not merely hide the result at render time.
    await expectApiError(
      recordLocation(member.id, {
        familyId,
        latitude: ACCRA.latitude,
        longitude: ACCRA.longitude,
        recordedAt: new Date(),
      }),
      403,
    );
  });

  it('refuses a non-member outright', async () => {
    await expectApiError(
      recordLocation(outsider.id, {
        familyId,
        latitude: ACCRA.latitude,
        longitude: ACCRA.longitude,
        recordedAt: new Date(),
      }),
      404,
    );
  });

  it('writes both history and the current position', async () => {
    await share(member);

    const history = await db
      .select()
      .from(locations)
      .where(and(eq(locations.userId, member.id), eq(locations.familyId, familyId)));
    const current = await db
      .select()
      .from(currentLocations)
      .where(
        and(eq(currentLocations.userId, member.id), eq(currentLocations.familyId, familyId)),
      );

    expect(history).toHaveLength(1);
    expect(current).toHaveLength(1);
  });

  it('does not move a member backwards when fixes arrive out of order', async () => {
    await updateSharingSettings(member.id, familyId, { state: 'sharing' });

    const newer = new Date();
    const older = new Date(newer.getTime() - 60_000);

    await recordLocation(member.id, { familyId, ...ACCRA, recordedAt: newer });
    // A delayed older fix must not overwrite the newer current position.
    await recordLocation(member.id, { familyId, ...KUMASI, recordedAt: older });

    const [current] = await db
      .select()
      .from(currentLocations)
      .where(eq(currentLocations.userId, member.id));

    expect(current?.latitude).toBeCloseTo(ACCRA.latitude, 3);
    // Both fixes are still kept in history.
    expect(
      await db.$count(locations, eq(locations.userId, member.id)),
    ).toBe(2);
  });
});

describe('reading family locations', () => {
  it('refuses a non-member', async () => {
    await share(member);
    await expectApiError(getFamilyLocations(outsider.id, familyId), 404);
  });

  it('shows a sharing member to the rest of the family', async () => {
    await share(member);

    const result = await getFamilyLocations(owner.id, familyId);

    expect(result.locations).toHaveLength(1);
    expect(result.locations[0]?.userId).toBe(member.id);
    expect(result.locations[0]?.latitude).toBeCloseTo(ACCRA.latitude, 3);
  });

  it('withholds the location of a member who has paused', async () => {
    await share(member);
    await updateSharingSettings(member.id, familyId, { state: 'paused' });

    const result = await getFamilyLocations(owner.id, familyId);

    expect(result.locations.map((l) => l.userId)).not.toContain(member.id);
    expect(result.withheld.find((w) => w.userId === member.id)?.reason).toBe('paused');
  });

  it('withholds the location of a member whose visibility is nobody', async () => {
    await share(member);
    await updateSharingSettings(member.id, familyId, { visibility: 'nobody' });

    const result = await getFamilyLocations(owner.id, familyId);

    expect(result.locations.map((l) => l.userId)).not.toContain(member.id);
    expect(result.withheld.find((w) => w.userId === member.id)?.reason).toBe('hidden');
  });

  it('still shows a hidden member their own location', async () => {
    await share(member);
    await updateSharingSettings(member.id, familyId, { visibility: 'nobody' });

    const result = await getFamilyLocations(member.id, familyId);

    expect(result.locations.map((l) => l.userId)).toContain(member.id);
  });

  it('erases the current position the moment sharing is switched off', async () => {
    await share(member);
    await updateSharingSettings(member.id, familyId, { state: 'off' });

    // Not merely filtered out of the response — actually gone from the table,
    // so no stale dot can linger on anyone's map.
    const rows = await db
      .select()
      .from(currentLocations)
      .where(eq(currentLocations.userId, member.id));

    expect(rows).toHaveLength(0);

    const result = await getFamilyLocations(owner.id, familyId);
    expect(result.locations.map((l) => l.userId)).not.toContain(member.id);
  });

  it('stops exposing a location to someone who has been removed', async () => {
    await share(owner);
    await removeMember(owner.id, familyId, member.id);

    await expectApiError(getFamilyLocations(member.id, familyId), 404);
  });

  it('never leaks locations across families', async () => {
    await share(member);

    const otherFamily = await createFamily(outsider.id, 'Other Family');
    await updateSharingSettings(outsider.id, otherFamily.id, { state: 'sharing' });
    await recordLocation(outsider.id, { familyId: otherFamily.id, ...KUMASI, recordedAt: new Date() });

    const ours = await getFamilyLocations(owner.id, familyId);
    const theirs = await getFamilyLocations(outsider.id, otherFamily.id);

    expect(ours.locations.map((l) => l.userId)).not.toContain(outsider.id);
    expect(theirs.locations.map((l) => l.userId)).not.toContain(member.id);
  });

  it('reports members who are permitted but have no fix yet', async () => {
    await updateSharingSettings(member.id, familyId, { state: 'sharing' });

    const result = await getFamilyLocations(owner.id, familyId);

    expect(result.locations).toHaveLength(0);
    expect(result.withheld.find((w) => w.userId === member.id)?.reason).toBe('no-fix');
  });
});

describe('sharing settings', () => {
  it('only ever changes the caller’s own membership', async () => {
    await updateSharingSettings(member.id, familyId, { state: 'sharing' });

    const [ownerRow] = await db
      .select()
      .from(familyMembers)
      .where(and(eq(familyMembers.userId, owner.id), eq(familyMembers.familyId, familyId)));

    // The owner's own setting is untouched by the member's change.
    expect(ownerRow?.locationSharingState).toBe('off');
  });

  it('refuses a non-member changing settings for a family', async () => {
    await expectApiError(
      updateSharingSettings(outsider.id, familyId, { state: 'sharing' }),
      404,
    );
  });

  it('keeps history when sharing is merely switched off', async () => {
    await share(member);
    await updateSharingSettings(member.id, familyId, { state: 'off' });

    // History is the member's own record; switching sharing off should not
    // silently destroy it.
    const history = await db.$count(locations, eq(locations.userId, member.id));
    expect(history).toBe(1);
  });
});

describe('stop sharing and forget', () => {
  it('erases both the current position and all history', async () => {
    await share(member);
    await stopSharingAndForget(member.id, familyId);

    expect(await db.$count(locations, eq(locations.userId, member.id))).toBe(0);
    expect(await db.$count(currentLocations, eq(currentLocations.userId, member.id))).toBe(0);

    const [row] = await db
      .select()
      .from(familyMembers)
      .where(and(eq(familyMembers.userId, member.id), eq(familyMembers.familyId, familyId)));
    expect(row?.locationSharingState).toBe('off');
  });

  it('does not touch anyone else’s history', async () => {
    await share(member);
    await share(owner);

    await stopSharingAndForget(member.id, familyId);

    expect(await db.$count(locations, eq(locations.userId, owner.id))).toBe(1);
  });

  it('refuses a non-member', async () => {
    await expectApiError(stopSharingAndForget(outsider.id, familyId), 404);
  });
});

describe('own history', () => {
  it('returns only the caller’s own points', async () => {
    await share(member);
    await share(owner, KUMASI);

    const from = new Date(Date.now() - 60 * 60 * 1000);
    const to = new Date(Date.now() + 60 * 60 * 1000);

    const memberHistory = await getOwnHistory(member.id, familyId, { from, to });

    expect(memberHistory).toHaveLength(1);
    expect(memberHistory[0]?.latitude).toBeCloseTo(ACCRA.latitude, 3);
  });

  it('refuses a non-member', async () => {
    const from = new Date(Date.now() - 60 * 60 * 1000);
    const to = new Date();

    await expectApiError(getOwnHistory(outsider.id, familyId, { from, to }), 404);
  });
});

/* ========================================================================== */

/**
 * Timed sharing.
 *
 * "Share where I am for the next hour" is the one shape of this feature a
 * family safety app most needs, because it lets somebody say yes without
 * saying yes forever. The service has enforced the window since it was
 * written — on write here, and again on read so a lapsed window cannot keep
 * showing a last known position — but the API schema omitted the field, so
 * nothing could ever set one. These cover the path now that it is reachable.
 */
describe('timed sharing', () => {
  /** Moves a member's window into the past without touching anything else. */
  async function expireWindow(user: TestUser) {
    await db
      .update(familyMembers)
      .set({ sharingExpiresAt: new Date(Date.now() - 60_000) })
      .where(and(eq(familyMembers.familyId, familyId), eq(familyMembers.userId, user.id)));
  }

  it('records when the window ends', async () => {
    const settings = await updateSharingSettings(member.id, familyId, {
      state: 'sharing',
      durationMinutes: 60,
    });

    expect(settings.expiresAt).toBeInstanceOf(Date);
    const minutes = (settings.expiresAt!.getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(58);
    expect(minutes).toBeLessThan(61);
  });

  it('shares until switched off when no window is asked for', async () => {
    const settings = await updateSharingSettings(member.id, familyId, { state: 'sharing' });

    expect(settings.expiresAt).toBeNull();
  });

  it('accepts positions while the window is open', async () => {
    await updateSharingSettings(member.id, familyId, {
      state: 'sharing',
      durationMinutes: 60,
    });

    await expect(
      recordLocation(member.id, {
        familyId,
        latitude: ACCRA.latitude,
        longitude: ACCRA.longitude,
        accuracy: 10,
        recordedAt: new Date(),
      }),
    ).resolves.toBeTruthy();
  });

  it('refuses positions once the window has lapsed', async () => {
    await share(member);
    await expireWindow(member);

    await expectApiError(
      recordLocation(member.id, {
        familyId,
        latitude: KUMASI.latitude,
        longitude: KUMASI.longitude,
        accuracy: 10,
        recordedAt: new Date(),
      }),
      403,
    );
  });

  /*
   * The half that matters most. A lapsed window with a position still in the
   * table would otherwise keep that position on the family's map for ever —
   * breaking the exact promise the window was made to keep.
   */
  it('stops showing the last position once the window has lapsed', async () => {
    await share(member);

    const before = await getFamilyLocations(owner.id, familyId);
    expect(before.locations.map((l) => l.userId)).toContain(member.id);

    await expireWindow(member);

    const after = await getFamilyLocations(owner.id, familyId);
    expect(after.locations.map((l) => l.userId)).not.toContain(member.id);
    expect(after.withheld.find((w) => w.userId === member.id)?.reason).toBe('not-sharing');
  });

  it('clears the window when sharing is switched off', async () => {
    await updateSharingSettings(member.id, familyId, {
      state: 'sharing',
      durationMinutes: 60,
    });

    const off = await updateSharingSettings(member.id, familyId, { state: 'off' });
    expect(off.expiresAt).toBeNull();

    // Turning it back on must not resurrect the old window.
    const on = await updateSharingSettings(member.id, familyId, { state: 'sharing' });
    expect(on.expiresAt).toBeNull();
  });

  it('lets a window be cleared without switching sharing off', async () => {
    await updateSharingSettings(member.id, familyId, {
      state: 'sharing',
      durationMinutes: 60,
    });

    const cleared = await updateSharingSettings(member.id, familyId, {
      durationMinutes: null,
    });

    expect(cleared.expiresAt).toBeNull();
    expect(cleared.state).toBe('sharing');
  });

  it('leaves an open window alone when pausing and resuming', async () => {
    const started = await updateSharingSettings(member.id, familyId, {
      state: 'sharing',
      durationMinutes: 60,
    });

    await updateSharingSettings(member.id, familyId, { state: 'paused' });
    const resumed = await updateSharingSettings(member.id, familyId, { state: 'sharing' });

    expect(resumed.expiresAt?.getTime()).toBe(started.expiresAt?.getTime());
  });
});

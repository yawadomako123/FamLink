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

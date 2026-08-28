import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import {
  acceptInvitation,
  createFamily,
  createInvitation,
} from '@/lib/families/service';
import {
  createPlace,
  deleteAllPlaces,
  deletePlace,
  listPlaceEvents,
  listPlaces,
  updatePlace,
} from '@/lib/places/service';
import { closeDatabase, createUser, resetDatabase, type TestUser } from './helpers/factories';

/**
 * Places: who may add, edit and remove them.
 *
 * The geofence maths had tests; the service around it had none, so nothing
 * covered who is allowed to touch a place or whether a place id from one
 * family can be reached from another.
 */

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

const HOME = {
  name: 'Home',
  latitude: 5.6037,
  longitude: -0.187,
  radius: 200,
  icon: 'home',
} as const;

let owner: TestUser;
let admin: TestUser;
let member: TestUser;
let other: TestUser;
let outsider: TestUser;
let familyId: string;
let otherFamilyId: string;

beforeEach(async () => {
  await resetDatabase();
  owner = await createUser('Ama Owner');
  admin = await createUser('Yaw Admin');
  member = await createUser('Kofi Member');
  other = await createUser('Esi Member');
  outsider = await createUser('Stranger Danger');

  const family = await createFamily(owner.id, 'The Boatengs');
  familyId = family.id;

  for (const [user, role] of [
    [admin, 'admin'],
    [member, 'member'],
    [other, 'member'],
  ] as const) {
    const invite = await createInvitation(owner.id, familyId, { role, expiresInHours: 24 });
    await acceptInvitation(user.id, invite.code);
  }

  const elsewhere = await createFamily(outsider.id, 'Somewhere Else');
  otherFamilyId = elsewhere.id;
});

afterAll(async () => {
  await closeDatabase();
});

/* ========================================================================== */

describe('creating', () => {
  it('lets any member add a place', async () => {
    const place = await createPlace(member.id, familyId, HOME);

    expect(place.name).toBe('Home');
    expect(place.createdBy).toBe(member.id);
    expect(await listPlaces(owner.id, familyId)).toHaveLength(1);
  });

  it('refuses a non-member', async () => {
    await expectApiError(createPlace(outsider.id, familyId, HOME), 404);
  });

  it('keeps each family’s places to itself', async () => {
    await createPlace(member.id, familyId, HOME);

    expect(await listPlaces(outsider.id, otherFamilyId)).toHaveLength(0);
  });
});

describe('reading', () => {
  it('refuses a non-member', async () => {
    await expectApiError(listPlaces(outsider.id, familyId), 404);
  });

  it('refuses place events to a non-member', async () => {
    await expectApiError(listPlaceEvents(outsider.id, familyId), 404);
  });
});

describe('editing', () => {
  it('lets the person who added it rename it', async () => {
    const place = await createPlace(member.id, familyId, HOME);
    const updated = await updatePlace(member.id, familyId, place.id, { name: 'Nana’s house' });

    expect(updated.name).toBe('Nana’s house');
  });

  it('lets an admin edit somebody else’s place', async () => {
    const place = await createPlace(member.id, familyId, HOME);
    const updated = await updatePlace(admin.id, familyId, place.id, { radius: 500 });

    expect(updated.radius).toBe(500);
  });

  it('lets the owner edit somebody else’s place', async () => {
    const place = await createPlace(member.id, familyId, HOME);

    await expect(
      updatePlace(owner.id, familyId, place.id, { name: 'Renamed' }),
    ).resolves.toBeTruthy();
  });

  it('refuses a plain member editing another member’s place', async () => {
    const place = await createPlace(member.id, familyId, HOME);

    await expectApiError(updatePlace(other.id, familyId, place.id, { name: 'Mine now' }), 403);
  });

  it('refuses a non-member', async () => {
    const place = await createPlace(member.id, familyId, HOME);

    await expectApiError(updatePlace(outsider.id, familyId, place.id, { name: 'Nope' }), 404);
  });

  /*
   * The scoping that matters most: a real place id, a real membership, but the
   * wrong family. Without the familyId in the WHERE clause this would resolve.
   */
  it('refuses a place id reached through another family', async () => {
    const place = await createPlace(member.id, familyId, HOME);

    await expectApiError(
      updatePlace(outsider.id, otherFamilyId, place.id, { name: 'Crossed over' }),
      404,
    );
  });
});

describe('deleting', () => {
  it('lets the creator delete their own place', async () => {
    const place = await createPlace(member.id, familyId, HOME);
    await deletePlace(member.id, familyId, place.id);

    expect(await listPlaces(owner.id, familyId)).toHaveLength(0);
  });

  it('lets an admin delete somebody else’s place', async () => {
    const place = await createPlace(member.id, familyId, HOME);
    await deletePlace(admin.id, familyId, place.id);

    expect(await listPlaces(owner.id, familyId)).toHaveLength(0);
  });

  it('refuses a plain member deleting another member’s place', async () => {
    const place = await createPlace(member.id, familyId, HOME);

    await expectApiError(deletePlace(other.id, familyId, place.id), 403);
    expect(await listPlaces(owner.id, familyId)).toHaveLength(1);
  });

  it('refuses a place id reached through another family', async () => {
    const place = await createPlace(member.id, familyId, HOME);

    await expectApiError(deletePlace(outsider.id, otherFamilyId, place.id), 404);
    expect(await listPlaces(owner.id, familyId)).toHaveLength(1);
  });
});

describe('clearing every place', () => {
  it('refuses a non-member', async () => {
    await createPlace(member.id, familyId, HOME);

    await expectApiError(deleteAllPlaces(outsider.id, familyId), 404);
    expect(await listPlaces(owner.id, familyId)).toHaveLength(1);
  });

  it('leaves other families untouched', async () => {
    await createPlace(member.id, familyId, HOME);
    await createPlace(outsider.id, otherFamilyId, { ...HOME, name: 'Their home' });

    await deleteAllPlaces(owner.id, familyId);

    expect(await listPlaces(owner.id, familyId)).toHaveLength(0);
    expect(await listPlaces(outsider.id, otherFamilyId)).toHaveLength(1);
  });
});

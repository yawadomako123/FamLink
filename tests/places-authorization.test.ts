import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { memberPlaceStates } from '@/lib/db/schema';
import { recordLocation, updateSharingSettings } from '@/lib/location/service';
import {
  listPlaceWatches,
  recipientsForPlaceEvent,
  setPlaceWatch,
} from '@/lib/places/watches';
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

/* ========================================================================== */

/**
 * Geofence transitions, written through a real position.
 *
 * `geofence.test.ts` covers the pure decision — given a point and some places,
 * what changed. This covers the half that touches the database:
 * `evaluateAndRecordGeofences` only runs when a family actually has places, so
 * nothing reached it before and its SQL had never executed once.
 */
describe('recording geofence transitions', () => {
  const HOME_POINT = { latitude: 5.6037, longitude: -0.187 };
  const FAR_AWAY = { latitude: 6.6885, longitude: -1.6244 };

  async function moveTo(user: TestUser, at: { latitude: number; longitude: number }, when: Date) {
    return recordLocation(user.id, {
      familyId,
      latitude: at.latitude,
      longitude: at.longitude,
      accuracy: 10,
      recordedAt: when,
    });
  }

  beforeEach(async () => {
    await createPlace(owner.id, familyId, { ...HOME, ...HOME_POINT, radius: 150 });
    await updateSharingSettings(member.id, familyId, { state: 'sharing' });
  });

  /*
   * A first fix establishes where somebody is without announcing it. Being
   * inside a radius is not an arrival; becoming inside is — so the very first
   * position FamLink ever judges must not claim they just got home when they
   * may have been there all along.
   */
  it('records the first fix silently rather than claiming an arrival', async () => {
    const result = await moveTo(member, HOME_POINT, new Date());

    expect(result.transitions).toEqual([]);
  });

  it('reports an arrival once there is a previous position to compare against', async () => {
    await moveTo(member, FAR_AWAY, new Date(Date.now() - 120_000));
    const arrived = await moveTo(member, HOME_POINT, new Date());

    expect(arrived.transitions).toHaveLength(1);
    expect(arrived.transitions[0]?.type).toBe('arrived');
    expect(arrived.transitions[0]?.placeName).toBe('Home');
  });

  it('says nothing while they stay put', async () => {
    await moveTo(member, HOME_POINT, new Date(Date.now() - 120_000));
    const again = await moveTo(member, HOME_POINT, new Date());

    expect(again.transitions).toEqual([]);
  });

  /*
   * The conflict-update path, which is where the `since` expression lives. It
   * only runs on a second position for the same member and place, so a first
   * arrival alone would never execute it.
   */
  it('reports a departure on the way out', async () => {
    await moveTo(member, HOME_POINT, new Date(Date.now() - 120_000));
    const left = await moveTo(member, FAR_AWAY, new Date());

    expect(left.transitions).toHaveLength(1);
    expect(left.transitions[0]?.type).toBe('left');
  });

  it('survives a full round trip', async () => {
    const t = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000);

    await moveTo(member, HOME_POINT, t(30));
    await moveTo(member, FAR_AWAY, t(20));
    const back = await moveTo(member, HOME_POINT, t(10));

    expect(back.transitions[0]?.type).toBe('arrived');
  });

  /*
   * `since` marks when the current state began, so it moves when the state
   * flips and holds while it is merely confirmed. It was written on insert and
   * never again, which left it meaning "first seen near here" while reading as
   * "here since" — a lie nothing surfaced yet, and would have the moment
   * anything did.
   */
  it('moves `since` when the state flips, and not when it is confirmed', async () => {
    const readSince = async () => {
      const [row] = await db
        .select({ since: memberPlaceStates.since, isInside: memberPlaceStates.isInside })
        .from(memberPlaceStates)
        .where(eq(memberPlaceStates.userId, member.id))
        .limit(1);
      return row;
    };

    const arrivedAt = new Date(Date.now() - 30 * 60_000);
    await moveTo(member, HOME_POINT, arrivedAt);
    const onArrival = await readSince();
    expect(onArrival?.isInside).toBe(true);

    // Still here — `since` must not creep forward to each new position.
    await moveTo(member, HOME_POINT, new Date(Date.now() - 20 * 60_000));
    const stillHere = await readSince();
    expect(stillHere?.since.getTime()).toBe(onArrival?.since.getTime());

    // Left — now it must move.
    const leftAt = new Date(Date.now() - 10 * 60_000);
    await moveTo(member, FAR_AWAY, leftAt);
    const afterLeaving = await readSince();

    expect(afterLeaving?.isInside).toBe(false);
    expect(afterLeaving?.since.getTime()).toBeGreaterThan(onArrival!.since.getTime());
  });
});

/* ========================================================================== */

/**
 * Who hears about which places.
 *
 * Arrivals and departures notify the whole family, governed by one switch each
 * in notification preferences. That is right for a household with two places
 * and unbearable with six, where the gym buries the school run and the only
 * remedy was switching arrivals off entirely.
 *
 * The rule these pin down is that a filter only ever *narrows*. A member who
 * has set none hears about everything, exactly as before — without which this
 * would have silenced every existing family the moment it shipped.
 */
describe('place notification filters', () => {
  let elsewherePlace: string;

  beforeEach(async () => {
    const home = await createPlace(owner.id, familyId, { ...HOME, name: 'Home' });
    elsewherePlace = home.id;
  });

  it('includes a member who has set no filter at all', async () => {
    const recipients = await recipientsForPlaceEvent(
      familyId,
      elsewherePlace,
      member.id,
      'arrived',
    );

    expect(recipients).toContain(owner.id);
  });

  it('never includes the person who moved', async () => {
    const recipients = await recipientsForPlaceEvent(
      familyId,
      elsewherePlace,
      member.id,
      'arrived',
    );

    expect(recipients).not.toContain(member.id);
  });

  it('drops somebody who switched arrivals off for this place', async () => {
    await setPlaceWatch(owner.id, familyId, elsewherePlace, { arrivals: false });

    const arriving = await recipientsForPlaceEvent(
      familyId,
      elsewherePlace,
      member.id,
      'arrived',
    );
    expect(arriving).not.toContain(owner.id);

    // Departures were untouched, so those still reach them.
    const leaving = await recipientsForPlaceEvent(familyId, elsewherePlace, member.id, 'left');
    expect(leaving).toContain(owner.id);
  });

  it('drops somebody who switched departures off for this place', async () => {
    await setPlaceWatch(owner.id, familyId, elsewherePlace, { departures: false });

    expect(
      await recipientsForPlaceEvent(familyId, elsewherePlace, member.id, 'left'),
    ).not.toContain(owner.id);
    expect(
      await recipientsForPlaceEvent(familyId, elsewherePlace, member.id, 'arrived'),
    ).toContain(owner.id);
  });

  /* One member's choice must not change what anybody else is told. */
  it('affects only the member who set it', async () => {
    await setPlaceWatch(owner.id, familyId, elsewherePlace, { arrivals: false });

    const recipients = await recipientsForPlaceEvent(
      familyId,
      elsewherePlace,
      member.id,
      'arrived',
    );

    expect(recipients).not.toContain(owner.id);
    expect(recipients).toContain(other.id);
  });

  it('applies only to the place it was set on', async () => {
    const gym = await createPlace(owner.id, familyId, { ...HOME, name: 'Gym' });
    await setPlaceWatch(owner.id, familyId, gym.id, { arrivals: false });

    expect(
      await recipientsForPlaceEvent(familyId, elsewherePlace, member.id, 'arrived'),
    ).toContain(owner.id);
    expect(await recipientsForPlaceEvent(familyId, gym.id, member.id, 'arrived')).not.toContain(
      owner.id,
    );
  });

  it('can be turned back on', async () => {
    await setPlaceWatch(owner.id, familyId, elsewherePlace, { arrivals: false });
    await setPlaceWatch(owner.id, familyId, elsewherePlace, { arrivals: true });

    expect(
      await recipientsForPlaceEvent(familyId, elsewherePlace, member.id, 'arrived'),
    ).toContain(owner.id);
  });

  it('reports the caller’s own filters, and only those', async () => {
    await setPlaceWatch(owner.id, familyId, elsewherePlace, { arrivals: false });

    const mine = await listPlaceWatches(owner.id, familyId);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ placeId: elsewherePlace, arrivals: false });

    // Somebody who has set none has none, rather than inheriting another's.
    expect(await listPlaceWatches(member.id, familyId)).toHaveLength(0);
  });

  it('refuses a place belonging to another family', async () => {
    const theirs = await createPlace(outsider.id, otherFamilyId, { ...HOME, name: 'Theirs' });

    await expectApiError(setPlaceWatch(owner.id, familyId, theirs.id, { arrivals: false }), 404);
  });

  it('refuses a non-member', async () => {
    await expectApiError(
      setPlaceWatch(outsider.id, familyId, elsewherePlace, { arrivals: false }),
      404,
    );
    await expectApiError(listPlaceWatches(outsider.id, familyId), 404);
  });

  it('goes away with the place it belongs to', async () => {
    await setPlaceWatch(owner.id, familyId, elsewherePlace, { arrivals: false });
    await deletePlace(owner.id, familyId, elsewherePlace);

    expect(await listPlaceWatches(owner.id, familyId)).toHaveLength(0);
  });

  /*
   * `notifyPlaceEvent` is called from `recordLocation` outside its try/catch,
   * so a throw while reading filters would take the position down with it —
   * the family would stop seeing somebody move because a notification
   * preference table was unavailable. A deploy landing before its migration is
   * the obvious way that happens.
   */
  it('notifies everyone rather than throwing if filters cannot be read', async () => {
    const original = db.select;
    let calls = 0;

    // Fail only the filter read: the member lookup happens first.
    const spy = vi.spyOn(db, 'select').mockImplementation(((...args: unknown[]) => {
      calls += 1;
      if (calls === 2) throw new Error('relation "place_watches" does not exist');
      return (original as (...a: unknown[]) => unknown).apply(db, args);
    }) as typeof db.select);

    try {
      const recipients = await recipientsForPlaceEvent(
        familyId,
        elsewherePlace,
        member.id,
        'arrived',
      );

      expect(recipients).toContain(owner.id);
      expect(recipients).not.toContain(member.id);
    } finally {
      spy.mockRestore();
    }
  });
});

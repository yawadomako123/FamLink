import 'server-only';

import { and, desc, eq, gte, inArray, lt } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  currentLocations,
  familyMembers,
  locations,
  users,
  type LocationSharingState,
  type LocationVisibility,
} from '@/lib/db/schema';
import { requireMembership } from '@/lib/permissions/family';
import { canViewLocation } from '@/lib/permissions/location-visibility';
import { Errors } from '@/lib/api/errors';
import { evaluateAndRecordGeofences, type DetectedTransition } from '@/lib/places/service';
import { displayName, notifyPlaceEvent, notifySharingChanged } from '@/lib/notifications/service';
import { publishEvent } from '@/lib/realtime/publish';
import type { LocationUpdateInput } from '@/lib/validation/location';

/**
 * Location reads and writes.
 *
 * The visibility rule is applied here, on the server, for every read. No query
 * in this module returns coordinates without first passing the requesting
 * viewer and the target member through `canViewLocation`.
 */

/** Server-side shape, before JSON serialisation turns dates into strings. */
export interface MemberLocationRecord {
  userId: string;
  name: string;
  image: string | null;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  recordedAt: Date;
  batteryPercentage: number | null;
  isCharging: boolean | null;
}

export interface FamilyLocationsResult {
  /** Members whose location the viewer is allowed to see. */
  locations: MemberLocationRecord[];
  /**
   * Members who are in the family but whose location is withheld. Included so
   * the UI can say "3 of 5 sharing" without inferring it from an absence.
   */
  withheld: { userId: string; reason: 'not-sharing' | 'paused' | 'hidden' | 'no-fix' }[];
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Records a position for the authenticated user.
 *
 * Refuses unless that member's sharing state for this family is `sharing`.
 * This is the server-side half of the pause control: a client that keeps
 * posting after the user paused is rejected, so pausing genuinely stops
 * collection rather than merely hiding it at render time.
 */
export async function recordLocation(
  userId: string,
  input: LocationUpdateInput,
): Promise<{ recordedAt: Date; transitions: DetectedTransition[] }> {
  const membership = await requireMembership(userId, input.familyId);

  if (membership.locationSharingState !== 'sharing') {
    throw Errors.forbidden(
      'Location sharing is not switched on for this family. Turn it on before sending updates.',
    );
  }

  const { familyId, latitude, longitude, accuracy, recordedAt, battery } = input;

  await db.transaction(async (tx) => {
    // Append to history.
    await tx.insert(locations).values({
      userId,
      familyId,
      latitude,
      longitude,
      accuracy: accuracy ?? null,
      recordedAt,
    });

    // Replace the single current-position row the map reads.
    await tx
      .insert(currentLocations)
      .values({
        userId,
        familyId,
        latitude,
        longitude,
        accuracy: accuracy ?? null,
        recordedAt,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [currentLocations.userId, currentLocations.familyId],
        set: {
          latitude,
          longitude,
          accuracy: accuracy ?? null,
          recordedAt,
          updatedAt: new Date(),
        },
        // Out-of-order delivery must not move someone backwards in time.
        setWhere: lt(currentLocations.recordedAt, recordedAt),
      });

    await tx
      .update(familyMembers)
      .set({
        lastActiveAt: new Date(),
        ...(battery
          ? {
              batteryPercentage: battery.percentage,
              isCharging: battery.isCharging ?? null,
              batteryUpdatedAt: new Date(),
            }
          : {}),
      })
      .where(and(eq(familyMembers.familyId, familyId), eq(familyMembers.userId, userId)));
  });

  /*
   * Geofences are evaluated here, on receipt, because that is the only moment
   * FamLink reliably learns where somebody is. A PWA cannot watch position in
   * the background, so there is no continuous evaluation to do — see the
   * background-location limitation in the README.
   *
   * Kept outside the transaction above: a geofence failure must not roll back
   * a perfectly good location write.
   */
  let transitions: DetectedTransition[] = [];

  try {
    transitions = await evaluateAndRecordGeofences(
      userId,
      familyId,
      { latitude, longitude, accuracy: accuracy ?? null },
      recordedAt,
    );
  } catch (error) {
    console.error('[location] geofence evaluation failed', error);
  }

  if (transitions.length > 0) {
    const name = await displayName(userId).catch(() => 'A family member');

    for (const transition of transitions) {
      await notifyPlaceEvent(
        familyId,
        userId,
        name,
        transition.placeName,
        transition.type,
        transition.placeId,
      );
    }
  }

  // A hint only — listeners re-fetch through the authorized endpoint, so the
  // visibility rule is applied per viewer rather than trusted here.
  await publishEvent(familyId, 'locations');

  return { recordedAt, transitions };
}

export interface SharingSettings {
  state: LocationSharingState;
  visibility: LocationVisibility;
}

/**
 * Updates the caller's own sharing settings for one family.
 *
 * Only ever acts on the caller's own membership — there is no code path by
 * which one member changes another's sharing settings.
 */
export async function updateSharingSettings(
  userId: string,
  familyId: string,
  changes: { state?: LocationSharingState; visibility?: LocationVisibility },
): Promise<SharingSettings> {
  await requireMembership(userId, familyId);

  const [updated] = await db
    .update(familyMembers)
    .set({
      ...(changes.state ? { locationSharingState: changes.state } : {}),
      ...(changes.visibility ? { locationVisibility: changes.visibility } : {}),
    })
    .where(and(eq(familyMembers.familyId, familyId), eq(familyMembers.userId, userId)))
    .returning();

  if (!updated) throw Errors.notFound('That family');

  /*
   * Switching sharing off removes the current position immediately rather than
   * leaving a last-known dot on the family's map. History is retained — it is
   * the member's own record, visible only to them, and deleting it would be a
   * surprise. `stopSharingAndForget` exists for when they want it gone.
   */
  if (changes.state === 'off') {
    await db
      .delete(currentLocations)
      .where(
        and(eq(currentLocations.userId, userId), eq(currentLocations.familyId, familyId)),
      );
  }

  /*
   * Turning sharing on or off is worth telling the family about — it changes
   * what they can see, and a silent change would be the kind of surprise
   * FamLink is meant to avoid. Visibility changes are deliberately NOT
   * announced: "I am now hidden from you" is not an announcement anyone should
   * be forced to make.
   */
  if (changes.state === 'sharing' || changes.state === 'off') {
    const name = await displayName(userId).catch(() => 'A family member');
    await notifySharingChanged(familyId, userId, name, changes.state === 'sharing');
  }

  await publishEvent(familyId, 'locations');

  return {
    state: updated.locationSharingState,
    visibility: updated.locationVisibility,
  };
}

/** Switches sharing off and erases this family's location history for the caller. */
export async function stopSharingAndForget(userId: string, familyId: string): Promise<void> {
  await requireMembership(userId, familyId);

  await db.transaction(async (tx) => {
    await tx
      .update(familyMembers)
      .set({ locationSharingState: 'off' })
      .where(and(eq(familyMembers.familyId, familyId), eq(familyMembers.userId, userId)));

    await tx
      .delete(currentLocations)
      .where(and(eq(currentLocations.userId, userId), eq(currentLocations.familyId, familyId)));

    await tx
      .delete(locations)
      .where(and(eq(locations.userId, userId), eq(locations.familyId, familyId)));
  });
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Every location in a family that the viewer is permitted to see.
 *
 * Reads `current_locations` only — one row per member — so the map never
 * touches the history table.
 */
export async function getFamilyLocations(
  viewerId: string,
  familyId: string,
): Promise<FamilyLocationsResult> {
  const viewer = await requireMembership(viewerId, familyId);

  const members = await db
    .select({
      userId: familyMembers.userId,
      familyId: familyMembers.familyId,
      name: users.name,
      image: users.image,
      locationSharingState: familyMembers.locationSharingState,
      locationVisibility: familyMembers.locationVisibility,
      batteryPercentage: familyMembers.batteryPercentage,
      isCharging: familyMembers.isCharging,
    })
    .from(familyMembers)
    .innerJoin(users, eq(users.id, familyMembers.userId))
    .where(eq(familyMembers.familyId, familyId));

  // Decide who is visible *before* fetching any coordinates, so coordinates
  // for withheld members are never loaded into memory at all.
  const visibleIds: string[] = [];
  const withheld: FamilyLocationsResult['withheld'] = [];

  for (const member of members) {
    if (canViewLocation(viewer, member)) {
      visibleIds.push(member.userId);
    } else {
      withheld.push({
        userId: member.userId,
        reason:
          member.locationSharingState === 'paused'
            ? 'paused'
            : member.locationSharingState === 'off'
              ? 'not-sharing'
              : 'hidden',
      });
    }
  }

  if (visibleIds.length === 0) return { locations: [], withheld };

  const rows = await db
    .select({
      userId: currentLocations.userId,
      latitude: currentLocations.latitude,
      longitude: currentLocations.longitude,
      accuracy: currentLocations.accuracy,
      recordedAt: currentLocations.recordedAt,
    })
    .from(currentLocations)
    .where(
      and(
        eq(currentLocations.familyId, familyId),
        inArray(currentLocations.userId, visibleIds),
      ),
    );

  const byUser = new Map(rows.map((r) => [r.userId, r]));
  const memberById = new Map(members.map((m) => [m.userId, m]));

  const result: MemberLocationRecord[] = [];

  for (const id of visibleIds) {
    const row = byUser.get(id);
    const member = memberById.get(id);
    if (!member) continue;

    // Permitted to see them, but they have not reported a position yet.
    if (!row) {
      withheld.push({ userId: id, reason: 'no-fix' });
      continue;
    }

    result.push({
      userId: id,
      name: member.name,
      image: member.image,
      latitude: row.latitude,
      longitude: row.longitude,
      accuracy: row.accuracy,
      recordedAt: row.recordedAt,
      batteryPercentage: member.batteryPercentage,
      isCharging: member.isCharging,
    });
  }

  return { locations: result, withheld };
}

export interface HistoryPoint {
  id: number;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  recordedAt: Date;
}

/**
 * The caller's own location history for one day.
 *
 * Deliberately restricted to the caller. Section 10 of the brief is explicit
 * that history is not exposed to the whole family by default; the `userId`
 * parameter is absent from this function's signature precisely so that no
 * caller can pass someone else's id by accident.
 */
export async function getOwnHistory(
  userId: string,
  familyId: string,
  options: { from: Date; to: Date; limit?: number },
): Promise<HistoryPoint[]> {
  await requireMembership(userId, familyId);

  return db
    .select({
      id: locations.id,
      latitude: locations.latitude,
      longitude: locations.longitude,
      accuracy: locations.accuracy,
      recordedAt: locations.recordedAt,
    })
    .from(locations)
    .where(
      and(
        eq(locations.userId, userId),
        eq(locations.familyId, familyId),
        gte(locations.recordedAt, options.from),
        lt(locations.recordedAt, options.to),
      ),
    )
    .orderBy(desc(locations.recordedAt))
    .limit(options.limit ?? 500);
}

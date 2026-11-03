import 'server-only';

import { and, eq, inArray, ne } from 'drizzle-orm';
import { db } from '@/lib/db';
import { familyMembers, placeWatches, places } from '@/lib/db/schema';
import { Errors } from '@/lib/api/errors';
import { requireMembership } from '@/lib/permissions/family';

/**
 * Who hears about which places.
 *
 * Arrivals and departures already notify everybody in the family, governed by
 * one switch each in notification preferences. That is right for a household
 * with two places and unbearable with six: the gym and the corner shop bury
 * the school run, and the only remedy was switching arrivals off entirely.
 *
 * ## A filter, not a subscription
 *
 * A member with no rows here hears about every place, exactly as before —
 * which matters, because the alternative would have silently stopped every
 * existing family's notifications the moment this shipped. Rows only ever
 * narrow, and each member's rows govern only their own notifications.
 */

export interface PlaceWatch {
  placeId: string;
  arrivals: boolean;
  departures: boolean;
}

/**
 * The caller's own filters for one family.
 *
 * Places with no row are absent rather than returned as `true/true`, so a
 * caller can tell "hears about everything by default" from "chose to hear
 * about this one" — the UI needs that distinction to avoid writing a row for
 * every place the first time anybody opens the screen.
 */
export async function listPlaceWatches(
  userId: string,
  familyId: string,
): Promise<PlaceWatch[]> {
  await requireMembership(userId, familyId);

  return db
    .select({
      placeId: placeWatches.placeId,
      arrivals: placeWatches.arrivals,
      departures: placeWatches.departures,
    })
    .from(placeWatches)
    .where(and(eq(placeWatches.userId, userId), eq(placeWatches.familyId, familyId)));
}

/**
 * Sets the caller's filter for one place.
 *
 * Both flags true is stored rather than deleted: it is the same as having no
 * row today, but it records a decision, and a member who has deliberately
 * turned everything on for a place should not silently lose it if the
 * defaults ever change.
 */
export async function setPlaceWatch(
  userId: string,
  familyId: string,
  placeId: string,
  changes: { arrivals?: boolean; departures?: boolean },
): Promise<PlaceWatch> {
  await requireMembership(userId, familyId);

  // Scoped by family as well as id, so a place from another household cannot
  // be reached by guessing.
  const [place] = await db
    .select({ id: places.id })
    .from(places)
    .where(and(eq(places.id, placeId), eq(places.familyId, familyId)))
    .limit(1);

  if (!place) throw Errors.notFound('That place');

  const arrivals = changes.arrivals ?? true;
  const departures = changes.departures ?? true;

  const [row] = await db
    .insert(placeWatches)
    .values({ userId, placeId, familyId, arrivals, departures })
    .onConflictDoUpdate({
      target: [placeWatches.userId, placeWatches.placeId],
      set: {
        ...(changes.arrivals !== undefined ? { arrivals: changes.arrivals } : {}),
        ...(changes.departures !== undefined ? { departures: changes.departures } : {}),
        updatedAt: new Date(),
      },
    })
    .returning({
      placeId: placeWatches.placeId,
      arrivals: placeWatches.arrivals,
      departures: placeWatches.departures,
    });

  if (!row) throw Errors.internal();
  return row;
}

/**
 * The members who should be told about one transition.
 *
 * Returns family members minus the person who moved, minus anyone who has
 * explicitly filtered this place out. The global `arrivals` / `departures`
 * preferences are applied later by `notifyFamily`, so this narrows and never
 * widens: somebody who switched arrivals off entirely is not brought back by
 * having a row here.
 */
export async function recipientsForPlaceEvent(
  familyId: string,
  placeId: string,
  actorId: string,
  type: 'arrived' | 'left',
): Promise<string[]> {
  const members = await db
    .select({ userId: familyMembers.userId })
    .from(familyMembers)
    .where(and(eq(familyMembers.familyId, familyId), ne(familyMembers.userId, actorId)));

  if (members.length === 0) return [];

  const candidateIds = members.map((m) => m.userId);

  /*
   * A filter that cannot be read is not a reason to lose anything.
   *
   * `notifyPlaceEvent` is called from `recordLocation` outside its try/catch,
   * so a throw here would take the whole position down with it — the family
   * would stop seeing somebody move because a *notification preference* table
   * was unavailable. A deploy that lands before its migration is the obvious
   * way that happens, and it is the wrong thing to be fragile about.
   *
   * Falling back to every member is the behaviour that existed before filters
   * did: noisier than intended, never silent, and never lossy.
   */
  let filters: { userId: string; arrivals: boolean; departures: boolean }[] = [];

  try {
    filters = await db
      .select({
        userId: placeWatches.userId,
        arrivals: placeWatches.arrivals,
        departures: placeWatches.departures,
      })
      .from(placeWatches)
      .where(and(eq(placeWatches.placeId, placeId), inArray(placeWatches.userId, candidateIds)));
  } catch (error) {
    console.error('[places] could not read notification filters; notifying everyone', error);
    return candidateIds;
  }

  const byUser = new Map(filters.map((f) => [f.userId, f]));

  return candidateIds.filter((id) => {
    const filter = byUser.get(id);
    // No row: hears about every place, which is how this behaved before
    // filters existed and must keep behaving for families that never set one.
    if (!filter) return true;
    return type === 'arrived' ? filter.arrivals : filter.departures;
  });
}

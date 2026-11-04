import type { LocationSharingState } from '@/lib/db/schema';

/**
 * What a timed sharing window actually means once it has lapsed.
 *
 * A window that ends does not update the row it lives on. Nothing does, unless
 * the member sends another position — and somebody whose hour is up has
 * usually stopped. So `location_sharing_state` stays `sharing` indefinitely
 * beside a `sharing_expires_at` in the past, and every reader that trusts the
 * column is wrong from that moment on.
 *
 * `getFamilyLocations` already knew this and corrected for it, which is why
 * the map was right. Three other readers did not: the dashboard, the family
 * member list, and — worst of the three — the member's own sharing switch,
 * which initialises from this column and so sat in the "on" position after
 * sharing had ended. The whole promise of the feature is that it ends, and
 * most of the app said it had not.
 *
 * Kept as a pure function in its own module so that `lib/families/queries.ts`
 * can apply the same rule without importing the location service, and so the
 * rule exists once rather than being re-derived per screen.
 */

export interface TimedSharing {
  locationSharingState: LocationSharingState;
  sharingExpiresAt: Date | null;
}

/** True once a timed window has run out. */
export function hasSharingLapsed(row: TimedSharing, now: number = Date.now()): boolean {
  return row.sharingExpiresAt !== null && row.sharingExpiresAt.getTime() <= now;
}

/**
 * The row as it should be read, with a lapsed window reported as `off`.
 *
 * Returns the same object when nothing has lapsed, so callers mapping over a
 * list do not churn references for the common case.
 */
export function withSharingExpiry<T extends TimedSharing>(row: T, now: number = Date.now()): T {
  if (!hasSharingLapsed(row, now)) return row;

  // `off` rather than `paused`: paused is a choice the member made and can
  // undo from the switch, and a window running out is not that.
  return { ...row, locationSharingState: 'off' as LocationSharingState };
}

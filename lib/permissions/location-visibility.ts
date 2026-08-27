import type { FamilyMember } from '@/lib/db/schema';
import { DomainErrors } from '@/lib/api/errors';

/**
 * The location visibility rule.
 *
 * This module is deliberately free of any database, environment or framework
 * dependency — it imports types and an error constructor, nothing more. That
 * keeps the most security-sensitive decision in the product directly
 * unit-testable, and means it cannot acquire hidden state over time.
 *
 * `lib/permissions/family.ts` holds the database-backed membership lookups
 * that feed this function.
 */

export type LocationViewer = Pick<FamilyMember, 'userId' | 'familyId'>;

export type LocationTarget = Pick<
  FamilyMember,
  'userId' | 'familyId' | 'locationSharingState' | 'locationVisibility'
>;

/**
 * A viewer may see a target's location only if all of the following hold:
 *   1. the viewer is a member of the family,
 *   2. the target is a member of the same family,
 *   3. the target's sharing state for that family is `sharing`, and
 *   4. the target's visibility admits this viewer.
 *
 * A member can always see their own location, whatever their settings say.
 */
export function canViewLocation(
  viewer: LocationViewer,
  target: LocationTarget,
  /** Populated only when the target's visibility is `selected`. */
  selectedViewerIds?: ReadonlySet<string>,
): boolean {
  // Different families should never have been compared in the first place.
  if (viewer.familyId !== target.familyId) return false;

  // Your own location is always yours to see.
  if (viewer.userId === target.userId) return true;

  // Paused and off both withhold the location; only `sharing` reveals it.
  if (target.locationSharingState !== 'sharing') return false;

  switch (target.locationVisibility) {
    case 'everyone':
      return true;
    case 'nobody':
      return false;
    case 'selected':
      // Reserved for a later release. Absent an explicit allow-list, deny.
      return selectedViewerIds?.has(viewer.userId) ?? false;
    default: {
      // Exhaustiveness guard: a new visibility mode must be handled explicitly
      // rather than defaulting to disclosure.
      const _never: never = target.locationVisibility;
      void _never;
      return false;
    }
  }
}

/** Throwing form, for endpoints that serve a single member's location. */
export function assertCanViewLocation(
  viewer: LocationViewer,
  target: LocationTarget,
  selectedViewerIds?: ReadonlySet<string>,
): void {
  if (!canViewLocation(viewer, target, selectedViewerIds)) {
    throw DomainErrors.locationNotShared();
  }
}

/* -------------------------------------------------------------------------- */
/* Role ranking                                                                */
/* -------------------------------------------------------------------------- */

/** Ranked so comparisons like "at least admin" are a single lookup. */
const ROLE_RANK: Record<FamilyMember['role'], number> = {
  member: 0,
  admin: 1,
  owner: 2,
};

export function roleAtLeast(
  role: FamilyMember['role'],
  minimum: FamilyMember['role'],
): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

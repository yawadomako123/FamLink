import 'server-only';

import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { familyMembers, type FamilyMember, type FamilyRole } from '@/lib/db/schema';
import { DomainErrors, Errors } from '@/lib/api/errors';
import { roleAtLeast } from './location-visibility';

/**
 * Family authorization — the database-backed half.
 *
 * Every server-side entry point that touches family-scoped data goes through
 * this module. Nothing here trusts a family id, member id or role supplied by
 * the client: each is re-derived from the database against the authenticated
 * user on every call.
 *
 * The pure visibility rule lives in ./location-visibility so it stays
 * dependency-free and directly testable.
 */

export {
  canViewLocation,
  assertCanViewLocation,
  roleAtLeast,
  type LocationViewer,
  type LocationTarget,
} from './location-visibility';

/**
 * Returns the caller's membership row, or null if they are not in the family.
 * Prefer `requireMembership` unless absence is genuinely a valid outcome.
 */
export async function getMembership(
  userId: string,
  familyId: string,
): Promise<FamilyMember | null> {
  const [membership] = await db
    .select()
    .from(familyMembers)
    .where(and(eq(familyMembers.userId, userId), eq(familyMembers.familyId, familyId)))
    .limit(1);

  return membership ?? null;
}

/**
 * Asserts membership.
 *
 * Throws 404 rather than 403 for non-members: a stranger probing family ids
 * must not be able to tell a real family from an imaginary one.
 */
export async function requireMembership(
  userId: string,
  familyId: string,
): Promise<FamilyMember> {
  const membership = await getMembership(userId, familyId);
  if (!membership) throw Errors.notFound('That family');
  return membership;
}

/**
 * Asserts membership *and* a minimum role. Existing members get a 403 with an
 * explanatory message, since they already know the family exists.
 */
export async function requireRole(
  userId: string,
  familyId: string,
  minimum: FamilyRole,
): Promise<FamilyMember> {
  const membership = await requireMembership(userId, familyId);

  if (!roleAtLeast(membership.role, minimum)) {
    throw Errors.forbidden(
      minimum === 'owner'
        ? 'Only the family owner can do that.'
        : 'Only family owners and admins can do that.',
    );
  }

  return membership;
}

/** Both members of a pair must belong to the same family. */
export async function requireSameFamily(
  viewerId: string,
  targetUserId: string,
  familyId: string,
): Promise<{ viewer: FamilyMember; target: FamilyMember }> {
  const viewer = await requireMembership(viewerId, familyId);

  const target = await getMembership(targetUserId, familyId);
  if (!target) throw DomainErrors.notAMember();

  return { viewer, target };
}

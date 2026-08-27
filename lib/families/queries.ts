import 'server-only';

import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  families,
  familyMembers,
  invitations,
  users,
  type FamilyRole,
  type LocationSharingState,
  type LocationVisibility,
} from '@/lib/db/schema';
import { requireMembership, requireRole } from '@/lib/permissions/family';
import { invitationStatus, type InvitationStatus } from './invitations';

/* -------------------------------------------------------------------------- */
/* Shapes returned to the UI                                                   */
/* -------------------------------------------------------------------------- */

export interface FamilySummary {
  id: string;
  name: string;
  ownerId: string;
  role: FamilyRole;
  joinedAt: Date;
  memberCount: number;
}

export interface FamilyMemberView {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  role: FamilyRole;
  joinedAt: Date;
  /** The member's own sharing settings. Visible to the whole family: knowing
   *  *whether* someone shares is not the same as knowing where they are. */
  locationSharingState: LocationSharingState;
  locationVisibility: LocationVisibility;
  lastActiveAt: Date | null;
  batteryPercentage: number | null;
  isCharging: boolean | null;
  batteryUpdatedAt: Date | null;
}

export interface InvitationView {
  id: string;
  role: FamilyRole;
  createdBy: string;
  createdByName: string;
  expiresAt: Date;
  createdAt: Date;
  status: InvitationStatus;
}

/* -------------------------------------------------------------------------- */
/* Queries                                                                     */
/* -------------------------------------------------------------------------- */

/** Every family the user belongs to, oldest membership first. */
export async function listUserFamilies(userId: string): Promise<FamilySummary[]> {
  const rows = await db
    .select({
      id: families.id,
      name: families.name,
      ownerId: families.ownerId,
      role: familyMembers.role,
      joinedAt: familyMembers.joinedAt,
    })
    .from(familyMembers)
    .innerJoin(families, eq(families.id, familyMembers.familyId))
    .where(eq(familyMembers.userId, userId))
    .orderBy(asc(familyMembers.joinedAt));

  if (rows.length === 0) return [];

  // One grouped count for all of them, rather than a round trip per family.
  const counts = await db
    .select({
      familyId: familyMembers.familyId,
      count: sql<number>`count(*)::int`,
    })
    .from(familyMembers)
    .where(
      inArray(
        familyMembers.familyId,
        rows.map((r) => r.id),
      ),
    )
    .groupBy(familyMembers.familyId);

  const countByFamily = new Map(counts.map((c) => [c.familyId, c.count]));

  return rows.map((row) => ({
    ...row,
    memberCount: countByFamily.get(row.id) ?? 1,
  }));
}

/**
 * The family's member list.
 *
 * Authorized: throws 404 unless the caller is a member. Returns each member's
 * sharing *state* but never their coordinates — those are served separately and
 * gated by the location visibility rule.
 */
export async function listFamilyMembers(
  callerId: string,
  familyId: string,
): Promise<FamilyMemberView[]> {
  await requireMembership(callerId, familyId);

  const rows = await db
    .select({
      userId: familyMembers.userId,
      name: users.name,
      email: users.email,
      image: users.image,
      role: familyMembers.role,
      joinedAt: familyMembers.joinedAt,
      locationSharingState: familyMembers.locationSharingState,
      locationVisibility: familyMembers.locationVisibility,
      lastActiveAt: familyMembers.lastActiveAt,
      batteryPercentage: familyMembers.batteryPercentage,
      isCharging: familyMembers.isCharging,
      batteryUpdatedAt: familyMembers.batteryUpdatedAt,
    })
    .from(familyMembers)
    .innerJoin(users, eq(users.id, familyMembers.userId))
    .where(eq(familyMembers.familyId, familyId))
    .orderBy(asc(familyMembers.joinedAt));

  return rows;
}

/** Family record plus the caller's own role. Authorized. */
export async function getFamilyForMember(callerId: string, familyId: string) {
  const membership = await requireMembership(callerId, familyId);

  const [family] = await db.select().from(families).where(eq(families.id, familyId)).limit(1);

  // requireMembership already proved the family exists, but the row could have
  // been deleted between the two statements.
  if (!family) return null;

  return { family, membership };
}

/**
 * Pending invitations for a family. Restricted to admins and owners.
 *
 * Returns metadata only — who created each invitation, its role and expiry —
 * never the code itself, which is unrecoverable by design. An admin who has
 * lost a link revokes it and issues a new one.
 */
export async function listFamilyInvitations(
  callerId: string,
  familyId: string,
): Promise<InvitationView[]> {
  await requireRole(callerId, familyId, 'admin');

  const rows = await db
    .select({
      id: invitations.id,
      role: invitations.role,
      createdBy: invitations.createdBy,
      createdByName: users.name,
      expiresAt: invitations.expiresAt,
      usedAt: invitations.usedAt,
      revokedAt: invitations.revokedAt,
      createdAt: invitations.createdAt,
    })
    .from(invitations)
    .innerJoin(users, eq(users.id, invitations.createdBy))
    .where(and(eq(invitations.familyId, familyId), isNull(invitations.usedAt)))
    .orderBy(desc(invitations.createdAt))
    .limit(50);

  return rows.map(({ usedAt, revokedAt, ...rest }) => ({
    ...rest,
    status: invitationStatus({ expiresAt: rest.expiresAt, usedAt, revokedAt }),
  }));
}

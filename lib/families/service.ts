import 'server-only';

import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  families,
  familyMembers,
  invitations,
  users,
  type Family,
  type FamilyMember,
  type FamilyRole,
} from '@/lib/db/schema';
import { DomainErrors, Errors } from '@/lib/api/errors';
import { getMembership, requireMembership, requireRole } from '@/lib/permissions/family';
import {
  generateInvitationCode,
  hashInvitationCode,
  invitationStatus,
} from './invitations';
import type { AssignableRole } from '@/lib/validation/family';

/**
 * Family mutations.
 *
 * Every function takes the *authenticated* caller id as its first argument and
 * re-checks authorization itself. None of them accept a role or membership id
 * from the client as evidence of anything.
 */

/** A user may not accumulate families without bound. */
export const MAX_FAMILIES_PER_USER = 10;
const MAX_MEMBERS_PER_FAMILY = 25;
const MAX_ACTIVE_INVITATIONS = 20;

/* -------------------------------------------------------------------------- */
/* Family lifecycle                                                            */
/* -------------------------------------------------------------------------- */

export async function createFamily(userId: string, name: string): Promise<Family> {
  const existing = await db.$count(familyMembers, eq(familyMembers.userId, userId));

  if (existing >= MAX_FAMILIES_PER_USER) {
    throw Errors.conflict(
      `You can belong to at most ${MAX_FAMILIES_PER_USER} families. Leave one before creating another.`,
    );
  }

  // The family and its owner membership must appear together or not at all;
  // a family with no members would be unreachable and unrecoverable.
  return db.transaction(async (tx) => {
    const [family] = await tx.insert(families).values({ name, ownerId: userId }).returning();

    if (!family) throw Errors.internal();

    await tx.insert(familyMembers).values({
      familyId: family.id,
      userId,
      role: 'owner',
      // Sharing starts off. Creating a family never opts you into being seen.
      locationSharingState: 'off',
      locationVisibility: 'everyone',
    });

    return family;
  });
}

export async function renameFamily(
  callerId: string,
  familyId: string,
  name: string,
): Promise<Family> {
  await requireRole(callerId, familyId, 'admin');

  const [updated] = await db
    .update(families)
    .set({ name, updatedAt: new Date() })
    .where(eq(families.id, familyId))
    .returning();

  if (!updated) throw Errors.notFound('That family');
  return updated;
}

/**
 * Leaving a family.
 *
 * The owner cannot leave while others remain — that would strand the family
 * with no one able to administer it. They must transfer ownership first. An
 * owner who is the last member deletes the family instead.
 */
export async function leaveFamily(callerId: string, familyId: string): Promise<void> {
  const membership = await requireMembership(callerId, familyId);

  const memberCount = await db.$count(familyMembers, eq(familyMembers.familyId, familyId));

  if (membership.role === 'owner') {
    if (memberCount > 1) throw DomainErrors.ownerCannotLeave();

    // Last member out deletes the family; cascades clear everything else.
    await db.delete(families).where(eq(families.id, familyId));
    return;
  }

  await db
    .delete(familyMembers)
    .where(and(eq(familyMembers.familyId, familyId), eq(familyMembers.userId, callerId)));
}

/* -------------------------------------------------------------------------- */
/* Membership management                                                       */
/* -------------------------------------------------------------------------- */

export async function removeMember(
  callerId: string,
  familyId: string,
  targetUserId: string,
): Promise<void> {
  const caller = await requireRole(callerId, familyId, 'admin');

  if (targetUserId === callerId) {
    throw Errors.badRequest('Use "leave family" to remove yourself.');
  }

  const target = await getMembership(targetUserId, familyId);
  if (!target) throw Errors.notFound('That member');

  // The owner is not removable by anyone, including themselves.
  if (target.role === 'owner') throw DomainErrors.cannotRemoveOwner();

  // An admin cannot remove a peer admin; only the owner can.
  if (target.role === 'admin' && caller.role !== 'owner') {
    throw Errors.forbidden('Only the family owner can remove an admin.');
  }

  await db
    .delete(familyMembers)
    .where(and(eq(familyMembers.familyId, familyId), eq(familyMembers.userId, targetUserId)));
}

export async function updateMemberRole(
  callerId: string,
  familyId: string,
  targetUserId: string,
  role: AssignableRole,
): Promise<FamilyMember> {
  // Granting and revoking admin is an owner-only power. Letting admins promote
  // each other makes the role boundary meaningless.
  await requireRole(callerId, familyId, 'owner');

  if (targetUserId === callerId) {
    throw Errors.badRequest('Transfer ownership instead of changing your own role.');
  }

  const target = await getMembership(targetUserId, familyId);
  if (!target) throw Errors.notFound('That member');
  if (target.role === 'owner') throw Errors.badRequest('The owner’s role cannot be changed.');

  const [updated] = await db
    .update(familyMembers)
    .set({ role })
    .where(and(eq(familyMembers.familyId, familyId), eq(familyMembers.userId, targetUserId)))
    .returning();

  if (!updated) throw Errors.notFound('That member');
  return updated;
}

/** Hands the owner role to another member; the old owner becomes an admin. */
export async function transferOwnership(
  callerId: string,
  familyId: string,
  targetUserId: string,
): Promise<void> {
  await requireRole(callerId, familyId, 'owner');

  if (targetUserId === callerId) {
    throw Errors.badRequest('You already own this family.');
  }

  const target = await getMembership(targetUserId, familyId);
  if (!target) throw Errors.notFound('That member');

  await db.transaction(async (tx) => {
    await tx.update(families).set({ ownerId: targetUserId, updatedAt: new Date() }).where(eq(families.id, familyId));

    await tx
      .update(familyMembers)
      .set({ role: 'owner' })
      .where(and(eq(familyMembers.familyId, familyId), eq(familyMembers.userId, targetUserId)));

    await tx
      .update(familyMembers)
      .set({ role: 'admin' })
      .where(and(eq(familyMembers.familyId, familyId), eq(familyMembers.userId, callerId)));
  });
}

/* -------------------------------------------------------------------------- */
/* Invitations                                                                 */
/* -------------------------------------------------------------------------- */

export interface CreatedInvitation {
  id: string;
  code: string;
  role: FamilyRole;
  expiresAt: Date;
}

export async function createInvitation(
  callerId: string,
  familyId: string,
  options: { role: AssignableRole; expiresInHours: number },
): Promise<CreatedInvitation> {
  await requireRole(callerId, familyId, 'admin');

  const active = await db.$count(
    invitations,
    and(
      eq(invitations.familyId, familyId),
      sql`${invitations.usedAt} is null`,
      sql`${invitations.revokedAt} is null`,
      sql`${invitations.expiresAt} > now()`,
    ),
  );

  if (active >= MAX_ACTIVE_INVITATIONS) {
    throw Errors.conflict(
      'This family already has the maximum number of open invitations. Revoke one first.',
    );
  }

  const code = generateInvitationCode();
  const expiresAt = new Date(Date.now() + options.expiresInHours * 60 * 60 * 1000);

  const [invitation] = await db
    .insert(invitations)
    .values({
      familyId,
      // Only the hash is persisted; `code` is returned to the caller once.
      codeHash: hashInvitationCode(code),
      role: options.role,
      createdBy: callerId,
      expiresAt,
    })
    .returning();

  if (!invitation) throw Errors.internal();

  return { id: invitation.id, code, role: invitation.role, expiresAt };
}

export async function revokeInvitation(
  callerId: string,
  familyId: string,
  invitationId: string,
): Promise<void> {
  await requireRole(callerId, familyId, 'admin');

  const [updated] = await db
    .update(invitations)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(invitations.id, invitationId),
        // Scoping by family id as well as invitation id prevents an admin of
        // one family from revoking another family's invitation by guessing.
        eq(invitations.familyId, familyId),
        sql`${invitations.usedAt} is null`,
        sql`${invitations.revokedAt} is null`,
      ),
    )
    .returning();

  if (!updated) throw Errors.notFound('That invitation');
}

export interface InvitationPreview {
  familyId: string;
  familyName: string;
  invitedByName: string;
  role: FamilyRole;
  memberCount: number;
  /** True when the viewer is already in this family. */
  alreadyMember: boolean;
}

/**
 * Looks up an invitation for the join screen.
 *
 * Reveals only the family's name, who invited you and how many members it has
 * — enough to decide whether to accept, and nothing about where anyone is.
 * Throws for expired, used or revoked codes so the UI can explain precisely
 * what went wrong.
 */
export async function previewInvitation(
  viewerId: string,
  code: string,
): Promise<InvitationPreview> {
  const [row] = await db
    .select({
      familyId: invitations.familyId,
      familyName: families.name,
      invitedByName: users.name,
      role: invitations.role,
      expiresAt: invitations.expiresAt,
      usedAt: invitations.usedAt,
      revokedAt: invitations.revokedAt,
    })
    .from(invitations)
    .innerJoin(families, eq(families.id, invitations.familyId))
    .innerJoin(users, eq(users.id, invitations.createdBy))
    // Look up by hash: the plaintext code is never used as a search key.
    .where(eq(invitations.codeHash, hashInvitationCode(code)))
    .limit(1);

  if (!row) throw Errors.notFound('That invitation');

  const status = invitationStatus(row);
  if (status === 'revoked') throw DomainErrors.invitationRevoked();
  if (status === 'used') throw DomainErrors.invitationUsed();
  if (status === 'expired') throw DomainErrors.invitationExpired();

  const memberCount = await db.$count(
    familyMembers,
    eq(familyMembers.familyId, row.familyId),
  );

  const existing = await getMembership(viewerId, row.familyId);

  return {
    familyId: row.familyId,
    familyName: row.familyName,
    invitedByName: row.invitedByName,
    role: row.role,
    memberCount,
    alreadyMember: existing !== null,
  };
}

export interface AcceptedInvitation {
  familyId: string;
  familyName: string;
  role: FamilyRole;
}

/**
 * Redeems an invitation.
 *
 * The whole redemption runs in one transaction, and the invitation is claimed
 * with a conditional UPDATE that only matches an unused, unrevoked, unexpired
 * row. That makes the single-use guarantee hold under concurrency: if two
 * people submit the same code simultaneously, exactly one UPDATE matches.
 */
export async function acceptInvitation(
  userId: string,
  code: string,
): Promise<AcceptedInvitation> {
  const codeHash = hashInvitationCode(code);

  return db.transaction(async (tx) => {
    const [invitation] = await tx
      .select()
      .from(invitations)
      .where(eq(invitations.codeHash, codeHash))
      .limit(1);

    if (!invitation) throw Errors.notFound('That invitation');

    const status = invitationStatus(invitation);
    if (status === 'revoked') throw DomainErrors.invitationRevoked();
    if (status === 'used') throw DomainErrors.invitationUsed();
    if (status === 'expired') throw DomainErrors.invitationExpired();

    const existing = await tx
      .select({ id: familyMembers.id })
      .from(familyMembers)
      .where(
        and(
          eq(familyMembers.familyId, invitation.familyId),
          eq(familyMembers.userId, userId),
        ),
      )
      .limit(1);

    if (existing.length > 0) throw DomainErrors.alreadyMember();

    /*
     * The same ceiling `createFamily` applies. It was checked only there, so
     * the limit could be walked straight past by being invited rather than
     * creating — which is the easier of the two things to do.
     */
    const belongsTo = await tx.$count(familyMembers, eq(familyMembers.userId, userId));
    if (belongsTo >= MAX_FAMILIES_PER_USER) {
      throw Errors.conflict(
        `You can belong to at most ${MAX_FAMILIES_PER_USER} families. Leave one before joining another.`,
      );
    }

    const memberCount = await tx.$count(
      familyMembers,
      eq(familyMembers.familyId, invitation.familyId),
    );

    if (memberCount >= MAX_MEMBERS_PER_FAMILY) {
      throw Errors.conflict(`This family has reached its limit of ${MAX_MEMBERS_PER_FAMILY} members.`);
    }

    // Claim the invitation. The WHERE clause is the concurrency guard: a
    // second concurrent redemption updates zero rows and is rejected.
    const claimed = await tx
      .update(invitations)
      .set({ usedAt: new Date(), usedBy: userId })
      .where(
        and(
          eq(invitations.id, invitation.id),
          sql`${invitations.usedAt} is null`,
          sql`${invitations.revokedAt} is null`,
        ),
      )
      .returning({ id: invitations.id });

    if (claimed.length === 0) throw DomainErrors.invitationUsed();

    await tx.insert(familyMembers).values({
      familyId: invitation.familyId,
      userId,
      role: invitation.role,
      // Joining a family never turns location sharing on.
      locationSharingState: 'off',
      locationVisibility: 'everyone',
    });

    const [family] = await tx
      .select({ name: families.name })
      .from(families)
      .where(eq(families.id, invitation.familyId))
      .limit(1);

    return {
      familyId: invitation.familyId,
      familyName: family?.name ?? 'your family',
      role: invitation.role,
    };
  });
}

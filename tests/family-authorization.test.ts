import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import {
  acceptInvitation,
  createFamily,
  createInvitation,
  leaveFamily,
  previewInvitation,
  removeMember,
  renameFamily,
  revokeInvitation,
  transferOwnership,
  updateMemberRole,
  MAX_FAMILIES_PER_USER,
} from '@/lib/families/service';
import { listFamilyInvitations, listFamilyMembers } from '@/lib/families/queries';
import { getMembership } from '@/lib/permissions/family';
import { closeDatabase, createUser, resetDatabase, type TestUser } from './helpers/factories';

/**
 * Family authorization, exercised against a real database.
 *
 * These rules live partly in SQL — transactions, conditional updates, cascade
 * deletes — so mocking the database would prove nothing about them.
 *
 * The suite is written from the attacker's side: for each capability, who is
 * refused matters more than who is allowed.
 */

/** Asserts a rejection carries a specific HTTP status and error code. */
async function expectApiError(
  promise: Promise<unknown>,
  status: number,
  code?: string,
): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    expect(error, `expected an ApiError, got ${String(error)}`).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(status);
    if (code) expect(apiError.code).toBe(code);
    return apiError;
  }

  throw new Error(`Expected the call to be rejected with ${status}, but it resolved.`);
}

let owner: TestUser;
let admin: TestUser;
let member: TestUser;
let outsider: TestUser;

beforeEach(async () => {
  await resetDatabase();
  owner = await createUser('Kofi Owner');
  admin = await createUser('Ama Admin');
  member = await createUser('Sarah Member');
  outsider = await createUser('Nosy Outsider');
});

afterAll(async () => {
  await closeDatabase();
});

/** Builds a family with owner, one admin and one plain member. */
async function seedFamily() {
  const family = await createFamily(owner.id, 'The Boatengs');

  for (const [user, role] of [
    [admin, 'admin'],
    [member, 'member'],
  ] as const) {
    const invite = await createInvitation(owner.id, family.id, {
      role,
      expiresInHours: 24,
    });
    await acceptInvitation(user.id, invite.code);
  }

  return family;
}

/* ========================================================================== */

describe('createFamily', () => {
  it('makes the creator the owner', async () => {
    const family = await createFamily(owner.id, 'The Boatengs');

    const membership = await getMembership(owner.id, family.id);
    expect(membership?.role).toBe('owner');
    expect(family.ownerId).toBe(owner.id);
  });

  it('starts the creator with location sharing switched off', async () => {
    // Creating a family must never opt you into being seen.
    const family = await createFamily(owner.id, 'The Boatengs');
    const membership = await getMembership(owner.id, family.id);

    expect(membership?.locationSharingState).toBe('off');
  });
});

describe('reading a family', () => {
  it('refuses a non-member with 404, not 403', async () => {
    const family = await seedFamily();

    // 404 rather than 403: a stranger must not be able to confirm that a
    // family id is real by the shape of the refusal.
    await expectApiError(listFamilyMembers(outsider.id, family.id), 404, 'NOT_FOUND');
  });

  it('refuses a member who has been removed', async () => {
    const family = await seedFamily();
    await removeMember(owner.id, family.id, member.id);

    await expectApiError(listFamilyMembers(member.id, family.id), 404);
  });

  it('lets any member read the roster', async () => {
    const family = await seedFamily();
    const members = await listFamilyMembers(member.id, family.id);

    expect(members).toHaveLength(3);
    expect(members.map((m) => m.role).sort()).toEqual(['admin', 'member', 'owner']);
  });

  it('never exposes coordinates through the member list', async () => {
    const family = await seedFamily();
    const [first] = await listFamilyMembers(member.id, family.id);

    expect(first).toBeDefined();
    expect(first).not.toHaveProperty('latitude');
    expect(first).not.toHaveProperty('longitude');
  });
});

describe('renaming a family', () => {
  it('refuses a plain member', async () => {
    const family = await seedFamily();
    await expectApiError(renameFamily(member.id, family.id, 'Hijacked'), 403, 'FORBIDDEN');
  });

  it('refuses a non-member with 404', async () => {
    const family = await seedFamily();
    await expectApiError(renameFamily(outsider.id, family.id, 'Hijacked'), 404);
  });

  it('allows an admin', async () => {
    const family = await seedFamily();
    const updated = await renameFamily(admin.id, family.id, 'The Mensahs');

    expect(updated.name).toBe('The Mensahs');
  });
});

describe('invitations', () => {
  it('refuses a plain member creating one', async () => {
    const family = await seedFamily();

    await expectApiError(
      createInvitation(member.id, family.id, { role: 'member', expiresInHours: 24 }),
      403,
    );
  });

  it('refuses a non-member creating one', async () => {
    const family = await seedFamily();

    await expectApiError(
      createInvitation(outsider.id, family.id, { role: 'member', expiresInHours: 24 }),
      404,
    );
  });

  it('hides open invite codes from plain members', async () => {
    const family = await seedFamily();
    await expectApiError(listFamilyInvitations(member.id, family.id), 403);
  });

  it('never persists the plaintext code', async () => {
    const family = await seedFamily();
    const invite = await createInvitation(owner.id, family.id, {
      role: 'member',
      expiresInHours: 24,
    });

    expect(invite.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);

    // A database leak must not yield working invitations, so scan every text
    // column of the row for the plaintext code.
    const { db } = await import('@/lib/db');
    const { sql } = await import('drizzle-orm');
    const result = await db.execute(
      sql`select * from invitations where id = ${invite.id}`,
    );

    const row = result.rows[0] as Record<string, unknown>;
    expect(row).toBeDefined();

    const persisted = Object.values(row).map(String);
    expect(persisted).not.toContain(invite.code);
    expect(persisted.join(' ')).not.toContain(invite.code);
  });

  it('does not expose codes through the invitation list', async () => {
    const family = await seedFamily();
    await createInvitation(owner.id, family.id, { role: 'member', expiresInHours: 24 });

    const [listed] = await listFamilyInvitations(owner.id, family.id);
    expect(listed).toBeDefined();
    expect(listed).not.toHaveProperty('code');
  });

  it('lets an invited user join with the right role', async () => {
    const family = await createFamily(owner.id, 'The Boatengs');
    const invite = await createInvitation(owner.id, family.id, {
      role: 'admin',
      expiresInHours: 24,
    });

    const result = await acceptInvitation(outsider.id, invite.code);

    expect(result.familyId).toBe(family.id);
    const membership = await getMembership(outsider.id, family.id);
    expect(membership?.role).toBe('admin');
  });

  it('joins with location sharing off', async () => {
    const family = await createFamily(owner.id, 'The Boatengs');
    const invite = await createInvitation(owner.id, family.id, {
      role: 'member',
      expiresInHours: 24,
    });

    await acceptInvitation(outsider.id, invite.code);

    const membership = await getMembership(outsider.id, family.id);
    expect(membership?.locationSharingState).toBe('off');
  });

  it('rejects a code that has already been used', async () => {
    const family = await createFamily(owner.id, 'The Boatengs');
    const invite = await createInvitation(owner.id, family.id, {
      role: 'member',
      expiresInHours: 24,
    });

    await acceptInvitation(member.id, invite.code);

    await expectApiError(acceptInvitation(outsider.id, invite.code), 410, 'INVITATION_USED');
  });

  it('rejects an expired code', async () => {
    const family = await createFamily(owner.id, 'The Boatengs');
    const invite = await createInvitation(owner.id, family.id, {
      role: 'member',
      // Already lapsed by the time it is redeemed.
      expiresInHours: 1,
    });

    // Move the expiry into the past rather than sleeping.
    const { db } = await import('@/lib/db');
    const { invitations } = await import('@/lib/db/schema');
    const { eq } = await import('drizzle-orm');
    await db
      .update(invitations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(invitations.id, invite.id));

    await expectApiError(acceptInvitation(outsider.id, invite.code), 410, 'INVITATION_EXPIRED');
  });

  it('rejects a revoked code', async () => {
    const family = await createFamily(owner.id, 'The Boatengs');
    const invite = await createInvitation(owner.id, family.id, {
      role: 'member',
      expiresInHours: 24,
    });

    await revokeInvitation(owner.id, family.id, invite.id);

    await expectApiError(acceptInvitation(outsider.id, invite.code), 410, 'INVITATION_REVOKED');
  });

  it('rejects a code that does not exist', async () => {
    await expectApiError(acceptInvitation(outsider.id, 'ZZZZ9999'), 404);
  });

  it('refuses to add someone who is already a member', async () => {
    const family = await seedFamily();
    const invite = await createInvitation(owner.id, family.id, {
      role: 'member',
      expiresInHours: 24,
    });

    await expectApiError(acceptInvitation(member.id, invite.code), 409, 'ALREADY_MEMBER');
  });

  it('admits exactly one of two simultaneous redemptions', async () => {
    const family = await createFamily(owner.id, 'The Boatengs');
    const invite = await createInvitation(owner.id, family.id, {
      role: 'member',
      expiresInHours: 24,
    });

    // The single-use guarantee has to hold under concurrency, not just in
    // sequence — this is what the conditional UPDATE in acceptInvitation buys.
    const results = await Promise.allSettled([
      acceptInvitation(member.id, invite.code),
      acceptInvitation(outsider.id, invite.code),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled).toHaveLength(1);
  });

  it('refuses an admin revoking another family’s invitation', async () => {
    const familyA = await createFamily(owner.id, 'Family A');
    const familyB = await createFamily(outsider.id, 'Family B');

    const inviteB = await createInvitation(outsider.id, familyB.id, {
      role: 'member',
      expiresInHours: 24,
    });

    // Owner of A supplies A's family id but B's invitation id.
    await expectApiError(revokeInvitation(owner.id, familyA.id, inviteB.id), 404);
  });
});

describe('invitation preview', () => {
  it('reveals the family name but nothing about locations', async () => {
    const family = await seedFamily();
    const invite = await createInvitation(owner.id, family.id, {
      role: 'member',
      expiresInHours: 24,
    });

    const preview = await previewInvitation(outsider.id, invite.code);

    expect(preview.familyName).toBe('The Boatengs');
    expect(preview.invitedByName).toBe('Kofi Owner');
    expect(preview.memberCount).toBe(3);
    expect(preview.alreadyMember).toBe(false);
    expect(Object.keys(preview)).not.toContain('members');
  });

  it('flags when the viewer is already a member', async () => {
    const family = await seedFamily();
    const invite = await createInvitation(owner.id, family.id, {
      role: 'member',
      expiresInHours: 24,
    });

    const preview = await previewInvitation(member.id, invite.code);
    expect(preview.alreadyMember).toBe(true);
  });
});

describe('removing members', () => {
  it('refuses a plain member removing anyone', async () => {
    const family = await seedFamily();
    await expectApiError(removeMember(member.id, family.id, admin.id), 403);
  });

  it('refuses removing the owner', async () => {
    const family = await seedFamily();
    await expectApiError(
      removeMember(admin.id, family.id, owner.id),
      409,
      'CANNOT_REMOVE_OWNER',
    );
  });

  it('refuses an admin removing a peer admin', async () => {
    const family = await seedFamily();
    const secondAdmin = await createUser('Kwame Admin');
    const invite = await createInvitation(owner.id, family.id, {
      role: 'admin',
      expiresInHours: 24,
    });
    await acceptInvitation(secondAdmin.id, invite.code);

    await expectApiError(removeMember(admin.id, family.id, secondAdmin.id), 403);
  });

  it('lets the owner remove an admin', async () => {
    const family = await seedFamily();
    await removeMember(owner.id, family.id, admin.id);

    expect(await getMembership(admin.id, family.id)).toBeNull();
  });

  it('refuses removing yourself, directing you to leave instead', async () => {
    const family = await seedFamily();
    await expectApiError(removeMember(admin.id, family.id, admin.id), 400);
  });
});

describe('roles', () => {
  it('refuses an admin promoting anyone', async () => {
    const family = await seedFamily();
    // Admins promoting each other would make the role boundary meaningless.
    await expectApiError(updateMemberRole(admin.id, family.id, member.id, 'admin'), 403);
  });

  it('lets the owner promote a member to admin', async () => {
    const family = await seedFamily();
    const updated = await updateMemberRole(owner.id, family.id, member.id, 'admin');

    expect(updated.role).toBe('admin');
  });

  it('refuses changing the owner’s role', async () => {
    const family = await seedFamily();
    const secondOwnerAttempt = updateMemberRole(owner.id, family.id, owner.id, 'admin');

    await expectApiError(secondOwnerAttempt, 400);
  });
});

describe('leaving and ownership', () => {
  it('refuses to let the owner leave while others remain', async () => {
    const family = await seedFamily();
    await expectApiError(leaveFamily(owner.id, family.id), 409, 'OWNER_CANNOT_LEAVE');
  });

  it('lets a member leave', async () => {
    const family = await seedFamily();
    await leaveFamily(member.id, family.id);

    expect(await getMembership(member.id, family.id)).toBeNull();
  });

  it('deletes the family when its last member is the owner', async () => {
    const family = await createFamily(owner.id, 'Solo Family');
    await leaveFamily(owner.id, family.id);

    await expectApiError(listFamilyMembers(owner.id, family.id), 404);
  });

  it('swaps roles on ownership transfer', async () => {
    const family = await seedFamily();
    await transferOwnership(owner.id, family.id, admin.id);

    expect((await getMembership(admin.id, family.id))?.role).toBe('owner');
    // The previous owner is demoted to admin, not dropped.
    expect((await getMembership(owner.id, family.id))?.role).toBe('admin');
  });

  it('refuses a non-owner transferring ownership', async () => {
    const family = await seedFamily();
    await expectApiError(transferOwnership(admin.id, family.id, member.id), 403);
  });

  it('lets the former owner leave once ownership has moved', async () => {
    const family = await seedFamily();
    await transferOwnership(owner.id, family.id, admin.id);

    await expect(leaveFamily(owner.id, family.id)).resolves.toBeUndefined();
  });
});

describe('cross-family isolation', () => {
  it('does not leak membership of one family into another', async () => {
    const familyA = await createFamily(owner.id, 'Family A');
    const familyB = await createFamily(outsider.id, 'Family B');

    await expectApiError(listFamilyMembers(owner.id, familyB.id), 404);
    await expectApiError(listFamilyMembers(outsider.id, familyA.id), 404);
  });

  it('does not let an owner of one family administer another', async () => {
    const familyB = await createFamily(outsider.id, 'Family B');

    // Being an owner somewhere grants nothing anywhere else.
    await expectApiError(renameFamily(owner.id, familyB.id, 'Taken over'), 404);
    await expectApiError(removeMember(owner.id, familyB.id, outsider.id), 404);
  });
});

/* ========================================================================== */

/**
 * The ceiling on how many families one person may belong to.
 *
 * `createFamily` has always enforced it. `acceptInvitation` did not, so the
 * limit could be walked past by being invited rather than creating — the
 * easier of the two things to do.
 */
describe('family count ceiling', () => {
  it('refuses an invitation once the caller is at the limit', async () => {
    const joiner = await createUser('Serial Joiner');

    // Fill the joiner up to the ceiling, invitation by invitation.
    for (let i = 0; i < MAX_FAMILIES_PER_USER; i += 1) {
      const host = await createUser(`Host ${i}`);
      const family = await createFamily(host.id, `Family ${i}`);
      const invite = await createInvitation(host.id, family.id, {
        role: 'member',
        expiresInHours: 24,
      });
      await acceptInvitation(joiner.id, invite.code);
    }

    const host = await createUser('One Too Many');
    const family = await createFamily(host.id, 'The Last Straw');
    const invite = await createInvitation(host.id, family.id, {
      role: 'member',
      expiresInHours: 24,
    });

    await expectApiError(acceptInvitation(joiner.id, invite.code), 409);
  });
});

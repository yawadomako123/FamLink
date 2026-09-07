import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { ApiError } from '@/lib/api/errors';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import {
  acceptInvitation,
  createFamily,
  createInvitation,
} from '@/lib/families/service';
import { sendMessage } from '@/lib/chat/service';
import * as adminService from '@/lib/admin/service';
import { closeDatabase, createUser, resetDatabase, type TestUser } from './helpers/factories';

/**
 * The platform admin boundary.
 *
 * Two things are being asserted, and the second matters as much as the first.
 *
 * That an ordinary member cannot reach any of it — including a family owner,
 * who has complete authority over their own household and none whatsoever
 * over the platform.
 *
 * And that an admin who *can* reach it still cannot read what families say to
 * each other. The whole app is built on membership being what grants access
 * to family data; an admin screen that returned message bodies or coordinates
 * would undo that for every family at once, so the shape of what comes back
 * is pinned here rather than left to review.
 */

/* The guard reads the session, which the service layer has no way to fake. */
let currentUserId: string | null = null;

vi.mock('@/lib/auth/session', () => ({
  getSession: async () =>
    currentUserId ? { user: { id: currentUserId }, session: { id: 'test' } } : null,
}));

const asUser = (user: TestUser | null) => {
  currentUserId = user?.id ?? null;
};

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

let admin: TestUser;
let owner: TestUser;
let member: TestUser;
let familyId: string;

beforeEach(async () => {
  await resetDatabase();

  admin = await createUser('Ada Operator');
  owner = await createUser('Ama Owner');
  member = await createUser('Kofi Member');

  const family = await createFamily(owner.id, 'The Boatengs');
  familyId = family.id;

  const invite = await createInvitation(owner.id, familyId, {
    role: 'member',
    expiresInHours: 24,
  });
  await acceptInvitation(member.id, invite.code);

  await db.update(users).set({ isPlatformAdmin: true }).where(eq(users.id, admin.id));
  asUser(null);
});

afterAll(async () => {
  currentUserId = null;
  await closeDatabase();
});

/* ========================================================================== */

describe('who may reach the admin area', () => {
  it('refuses an anonymous caller', async () => {
    asUser(null);

    await expectApiError(adminService.platformOverview(), 404);
  });

  it('refuses an ordinary member', async () => {
    asUser(member);

    await expectApiError(adminService.platformOverview(), 404);
  });

  /*
   * The distinction the whole module rests on. Owning a family is authority
   * inside that family and nowhere else.
   */
  it('refuses the owner of a family', async () => {
    asUser(owner);

    await expectApiError(adminService.platformOverview(), 404);
  });

  it('answers 404 rather than 403, so the area is not advertised', async () => {
    asUser(member);

    try {
      await adminService.platformOverview();
      throw new Error('expected a rejection');
    } catch (error) {
      expect((error as ApiError).status).toBe(404);
      expect((error as ApiError).status).not.toBe(403);
    }
  });

  it('admits a platform admin', async () => {
    asUser(admin);

    await expect(adminService.platformOverview()).resolves.toBeTruthy();
  });

  it('every read is guarded, not just the first', async () => {
    asUser(member);

    for (const call of [
      () => adminService.listUsers(),
      () => adminService.listFamilies(),
      () => adminService.dailyGrowth(7),
      () => adminService.deploymentHealth(),
      () => adminService.countPlatformAdmins(),
      () => adminService.revokeSessions(owner.id),
      () => adminService.setPlatformAdmin(owner.id, true),
    ]) {
      await expectApiError(call(), 404);
    }
  });

  /* Withdrawn access takes effect on the next call, not on the next session. */
  it('stops admitting somebody the moment the flag is removed', async () => {
    asUser(admin);
    await expect(adminService.platformOverview()).resolves.toBeTruthy();

    await db.update(users).set({ isPlatformAdmin: false }).where(eq(users.id, admin.id));

    await expectApiError(adminService.platformOverview(), 404);
  });
});

/* ========================================================================== */

describe('what an admin can see', () => {
  beforeEach(() => asUser(admin));

  it('counts people and families', async () => {
    const overview = await adminService.platformOverview();

    expect(overview.users.total).toBe(3);
    expect(overview.families.total).toBe(1);
    expect(overview.families.largest).toBe(2);
  });

  it('counts messages without carrying any of them', async () => {
    await sendMessage(member.id, familyId, 'the kids are home safe');

    const overview = await adminService.platformOverview();
    expect(overview.activity.messages).toBe(1);

    const { rows } = await adminService.listFamilies();
    expect(rows[0]?.messages).toBe(1);

    // The count is here; the sentence is not, anywhere in the payload.
    expect(JSON.stringify(rows)).not.toContain('kids are home safe');
    expect(JSON.stringify(overview)).not.toContain('kids are home safe');
  });

  it('lists families without exposing what is in them', async () => {
    await sendMessage(member.id, familyId, 'a private thing');

    const { rows } = await adminService.listFamilies();
    const family = rows[0];

    expect(family?.name).toBe('The Boatengs');
    expect(family?.members).toBe(2);
    expect(family?.ownerName).toBe('Ama Owner');
    // A timestamp says whether the household is alive. Nothing more.
    expect(family?.lastMessageAt).toBeInstanceOf(Date);

    for (const key of ['content', 'audioPath', 'latitude', 'longitude']) {
      expect(Object.keys(family ?? {})).not.toContain(key);
    }
  });

  it('finds a person by either half of what it knows about them', async () => {
    expect((await adminService.listUsers({ search: 'Kofi' })).rows).toHaveLength(1);
    expect((await adminService.listUsers({ search: member.email.split('@')[0] })).rows).toHaveLength(1);
    expect((await adminService.listUsers({ search: 'nobody at all' })).rows).toHaveLength(0);
  });

  it('reports how many families somebody belongs to', async () => {
    const { rows } = await adminService.listUsers({ search: 'Ama' });

    expect(rows[0]?.families).toBe(1);
  });

  it('fills in days on which nothing happened', async () => {
    const days = await adminService.dailyGrowth(7);

    expect(days).toHaveLength(7);
    expect(days.at(-1)?.users).toBeGreaterThanOrEqual(3);
    // Every day present, including the quiet ones.
    expect(days.every((d) => typeof d.users === 'number')).toBe(true);
  });
});

/* ========================================================================== */

describe('what an admin can do', () => {
  beforeEach(() => asUser(admin));

  it('signs somebody out of everywhere', async () => {
    // No sessions in this harness; the point is that it is permitted and safe.
    await expect(adminService.revokeSessions(member.id)).resolves.toBe(0);
  });

  it('grants admin to somebody else', async () => {
    await adminService.setPlatformAdmin(owner.id, true);
    expect(await adminService.countPlatformAdmins()).toBe(2);
  });

  /*
   * The one move with no way back from inside the app: an admin who removes
   * their own access can no longer reach the screen that would restore it.
   */
  it('refuses to let an admin lock themselves out', async () => {
    await expectApiError(adminService.setPlatformAdmin(admin.id, false), 400);

    const [row] = await db
      .select({ isPlatformAdmin: users.isPlatformAdmin })
      .from(users)
      .where(eq(users.id, admin.id));
    expect(row?.isPlatformAdmin).toBe(true);
  });

  it('allows one admin to withdraw another', async () => {
    await adminService.setPlatformAdmin(owner.id, true);
    await adminService.setPlatformAdmin(owner.id, false);

    expect(await adminService.countPlatformAdmins()).toBe(1);
  });
});

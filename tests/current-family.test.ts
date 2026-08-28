import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Which family the app shows you, end to end.
 *
 * The reported symptom: join a second family, and the next time you log in
 * you are looking at the old one again.
 *
 * `resolveCurrentFamily` reads a cookie and falls back to `families[0]` when
 * it is absent — and `listUserFamilies` orders by `joinedAt` ascending, so
 * `families[0]` is the family you joined *first*. The preference exists
 * nowhere else, so a login on a device that has no cookie cannot recover it.
 *
 * The cookie jar is in-memory rather than a real browser, which is the honest
 * limit of this test: it proves the server-side resolution, not that a real
 * Set-Cookie survives a real redirect.
 */
const { jar } = vi.hoisted(() => ({ jar: new Map<string, string>() }));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.has(name) ? { name, value: jar.get(name) as string } : undefined,
    set: (name: string, value: string) => {
      jar.set(name, value);
    },
    delete: (name: string) => {
      jar.delete(name);
    },
  }),
}));

const { resolveCurrentFamily, setCurrentFamily } = await import('@/lib/families/current');
const { acceptInvitation, createFamily, createInvitation, leaveFamily } = await import(
  '@/lib/families/service'
);
const { listUserFamilies } = await import('@/lib/families/queries');
const { closeDatabase, createUser, resetDatabase } = await import('./helpers/factories');

const COOKIE = 'famlink_family';

/** Everything a browser forgets between devices, or on sign-out. */
function forgetCookies() {
  jar.clear();
}

describe('current family resolution', () => {
  let viewer: Awaited<ReturnType<typeof createUser>>;
  let host: Awaited<ReturnType<typeof createUser>>;

  beforeEach(async () => {
    await resetDatabase();
    forgetCookies();
    viewer = await createUser('Viewer');
    host = await createUser('Host');
  });

  afterAll(async () => {
    await closeDatabase();
  });

  /** Joins `viewer` to a family owned by `host`, through the real invite path. */
  async function joinNewFamily(name: string): Promise<string> {
    const family = await createFamily(host.id, name);
    const invitation = await createInvitation(host.id, family.id, { role: 'member', expiresInHours: 72 });
    await acceptInvitation(viewer.id, invitation.code);
    return family.id;
  }

  it('orders families oldest first, which is what the fallback picks', async () => {
    const old = await createFamily(viewer.id, 'Old Family');
    const recent = await joinNewFamily('New Family');

    const families = await listUserFamilies(viewer.id);

    expect(families.map((f) => f.id)).toEqual([old.id, recent]);
  });

  it('shows the newly joined family while the cookie survives', async () => {
    await createFamily(viewer.id, 'Old Family');
    const recent = await joinNewFamily('New Family');

    // What the accept route does immediately after redeeming the code.
    await setCurrentFamily(viewer.id, recent);

    const { current } = await resolveCurrentFamily(viewer.id);
    expect(current?.id).toBe(recent);
  });

  // The reported bug, and the reason `users.last_family_id` exists. Before the
  // column, this returned the oldest family and there was no way to recover
  // the real choice — the cookie was the only place it had ever been written.
  it('remembers the joined family after the cookie is gone', async () => {
    const old = await createFamily(viewer.id, 'Old Family');
    const recent = await joinNewFamily('New Family');
    await setCurrentFamily(viewer.id, recent);

    // Logging in on another device, in a private window, or after clearing
    // site data. The membership is intact; only the cookie is missing.
    forgetCookies();

    const { current, families } = await resolveCurrentFamily(viewer.id);

    expect(families).toHaveLength(2);
    expect(
      current?.id,
      'expected the most recently joined family, got the oldest one',
    ).toBe(recent);
    expect(current?.id).not.toBe(old.id);
  });

  it('ignores a cookie naming a family the user is no longer in', async () => {
    const old = await createFamily(viewer.id, 'Old Family');
    const recent = await joinNewFamily('New Family');

    await setCurrentFamily(viewer.id, recent);
    await leaveFamily(viewer.id, recent);

    const { current } = await resolveCurrentFamily(viewer.id);
    expect(current?.id).toBe(old.id);
  });

  it('refuses to remember a family the user does not belong to', async () => {
    await createFamily(viewer.id, 'Old Family');
    const strangers = await createFamily(host.id, 'Not Mine');

    expect(await setCurrentFamily(viewer.id, strangers.id)).toBe(false);
    expect(jar.get(COOKIE)).toBeUndefined();
  });

  it('reports no family when there are none', async () => {
    const { current, families } = await resolveCurrentFamily(viewer.id);

    expect(current).toBeNull();
    expect(families).toEqual([]);
  });
});

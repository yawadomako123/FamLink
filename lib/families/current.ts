import 'server-only';

import { cookies } from 'next/headers';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { getMembership } from '@/lib/permissions/family';
import { listUserFamilies, type FamilySummary } from './queries';

/**
 * Resolves which family the user is currently looking at.
 *
 * Most people will only ever have one, but the data model supports several, so
 * the choice is remembered — in a cookie for this device, and on the user row
 * so it survives the device changing.
 *
 * The cookie is checked first on purpose: two devices may sit on different
 * families, and the one in your hand should win over what you last picked
 * elsewhere. The stored column is the fallback, and only when neither names a
 * family you are still in does this drop back to your oldest membership.
 *
 * Both are *preferences*, never authorization claims: membership is
 * re-verified against the family list on every read, so a forged cookie or a
 * stale column resolves to nothing.
 */
const COOKIE_NAME = 'famlink_family';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export interface CurrentFamily {
  current: FamilySummary | null;
  families: FamilySummary[];
}

export async function resolveCurrentFamily(userId: string): Promise<CurrentFamily> {
  const families = await listUserFamilies(userId);

  if (families.length === 0) return { current: null, families };

  const store = await cookies();
  const preferred = store.get(COOKIE_NAME)?.value;

  if (preferred) {
    const match = families.find((f) => f.id === preferred);
    // Only honour the cookie if it names a family they are actually in.
    if (match) return { current: match, families };
  }

  /*
   * No usable cookie: a new device, a private window, or cleared site data.
   * Without this the fallback below picked `families[0]` — the *oldest*
   * membership — so joining a new family and logging in again put you back in
   * the family you joined first, with no way to notice why.
   */
  const [row] = await db
    .select({ lastFamilyId: users.lastFamilyId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (row?.lastFamilyId) {
    const match = families.find((f) => f.id === row.lastFamilyId);
    if (match) return { current: match, families };
  }

  return { current: families[0] ?? null, families };
}

/**
 * Records the user's family choice, on this device and on the account.
 *
 * Verifies membership before writing, so a forged cookie value cannot be
 * persisted through this path either.
 */
export async function setCurrentFamily(userId: string, familyId: string): Promise<boolean> {
  const membership = await getMembership(userId, familyId);
  if (!membership) return false;

  await db.update(users).set({ lastFamilyId: familyId }).where(eq(users.id, userId));

  const store = await cookies();
  store.set(COOKIE_NAME, familyId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  });

  return true;
}

/**
 * Forgets the choice on this device.
 *
 * The stored column is deliberately left alone: this runs when somebody leaves
 * a family, and `resolveCurrentFamily` already discards a stored id that names
 * a family they are no longer in. Clearing it here would also throw away a
 * still-valid preference held for their other devices.
 */
export async function clearCurrentFamily(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

import 'server-only';

import { cookies } from 'next/headers';
import { getMembership } from '@/lib/permissions/family';
import { listUserFamilies, type FamilySummary } from './queries';

/**
 * Resolves which family the user is currently looking at.
 *
 * Most people will only ever have one, but the data model supports several, so
 * the choice is remembered in a cookie. The cookie is a *preference*, never an
 * authorization claim: membership is re-verified on every read, and an
 * unrecognised or stale value silently falls back to the first family.
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

  return { current: families[0] ?? null, families };
}

/**
 * Records the user's family choice.
 *
 * Verifies membership before writing, so a forged cookie value cannot be
 * persisted through this path either.
 */
export async function setCurrentFamily(userId: string, familyId: string): Promise<boolean> {
  const membership = await getMembership(userId, familyId);
  if (!membership) return false;

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

export async function clearCurrentFamily(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

import 'server-only';

import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { Errors } from '@/lib/api/errors';
import { getSession } from '@/lib/auth/session';

/**
 * The platform admin boundary.
 *
 * Deliberately separate from `lib/permissions/family`. That module answers
 * "may this person act inside this family"; this one answers "may this person
 * operate the service". A family owner has complete authority over their own
 * household and none at all here, and keeping the two in different files is
 * part of what stops one being mistaken for the other.
 *
 * The flag is re-read from the database on every call rather than taken from
 * the session. A session can outlive a revocation by up to its cookie-cache
 * window, which is an acceptable delay for "can you see the map" and not for
 * "can you see every account on the platform".
 */

export interface PlatformAdmin {
  id: string;
  name: string;
  email: string;
}

/** The caller if they operate the platform, otherwise null. */
export async function getPlatformAdmin(): Promise<PlatformAdmin | null> {
  const session = await getSession();
  if (!session) return null;

  const [row] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      isPlatformAdmin: users.isPlatformAdmin,
    })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  if (!row?.isPlatformAdmin) return null;

  return { id: row.id, name: row.name, email: row.email };
}

/**
 * For API routes. Throws 404, not 403.
 *
 * A signed-in member who is not an admin should not be able to learn that an
 * admin area exists by the shape of the refusal. There is nothing here they
 * are entitled to know about, including its existence.
 */
export async function requirePlatformAdmin(): Promise<PlatformAdmin> {
  const admin = await getPlatformAdmin();
  if (!admin) throw Errors.notFound('That page');
  return admin;
}

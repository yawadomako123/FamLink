import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db, pool } from '@/lib/db';
import { users } from '@/lib/db/schema';

/**
 * Test fixtures.
 *
 * Users are inserted directly rather than going through Better Auth: these
 * tests exercise FamLink's authorization rules, and a real sign-up flow would
 * add password hashing cost to every case without testing anything extra.
 */

/** Order matters only for readability — TRUNCATE CASCADE handles the graph. */
const TABLES = [
  'emergency_events',
  'place_events',
  'member_place_states',
  'places',
  'notifications',
  'message_reads',
  'messages',
  'current_locations',
  'locations',
  'location_shares',
  'invitations',
  'family_members',
  'families',
  'sessions',
  'accounts',
  'verifications',
  'users',
] as const;

export async function resetDatabase(): Promise<void> {
  await db.execute(
    sql.raw(`truncate table ${TABLES.map((t) => `"${t}"`).join(', ')} restart identity cascade`),
  );
}

export async function closeDatabase(): Promise<void> {
  await pool.end();
}

export interface TestUser {
  id: string;
  name: string;
  email: string;
}

export async function createUser(name: string): Promise<TestUser> {
  const id = randomUUID();
  const email = `${name.toLowerCase().replace(/\s+/g, '.')}.${id.slice(0, 8)}@famlink.test`;

  await db.insert(users).values({ id, name, email, emailVerified: true });

  return { id, name, email };
}

/** Creates several users in one statement. */
export async function createUsers<const T extends readonly string[]>(
  ...names: T
): Promise<{ [K in keyof T]: TestUser }> {
  const created = await Promise.all(names.map((n) => createUser(n)));
  return created as { [K in keyof T]: TestUser };
}

/**
 * Development seed.
 *
 * Creates a family with three members so the map, chat and alerts can be
 * exercised without manually registering several accounts. It is a development
 * fixture, not production data, and it refuses to run against anything that
 * looks like a production database.
 *
 * Usage: npm run db:seed
 */
import { config as loadEnv } from 'dotenv';
import { randomUUID } from 'node:crypto';

loadEnv({ path: '.env.local', quiet: true });
loadEnv({ path: '.env', quiet: true });

const url = process.env.DATABASE_URL ?? '';

/*
 * Guard first, before importing anything that opens a connection. Seeding
 * inserts fake people; doing that to a real family's database would be a
 * genuine harm, so the check is a refusal rather than a warning.
 */
const looksLocal =
  url.includes('localhost') || url.includes('127.0.0.1') || url.includes('famlink_test');

if (!looksLocal && process.env.ALLOW_REMOTE_SEED !== 'true') {
  console.error(
    [
      'Refusing to seed: DATABASE_URL does not look like a local database.',
      '',
      `  ${url.replace(/:[^:@/]+@/, ':****@') || '(unset)'}`,
      '',
      'Seeding inserts fictional users and messages. If you really mean to do',
      'this against a remote database, re-run with ALLOW_REMOTE_SEED=true.',
    ].join('\n'),
  );
  process.exit(1);
}

async function main() {
  // Imported lazily so the guard above runs before any connection is opened.
  const { db, pool } = await import('../lib/db');
  const { users, families, familyMembers, places, messages } = await import('../lib/db/schema');
  const { createFamily } = await import('../lib/families/service');
  const { sendMessage } = await import('../lib/chat/service');
  const { eq, inArray } = await import('drizzle-orm');

  const PEOPLE = [
    { key: 'ama', name: 'Ama Boateng' },
    { key: 'kofi', name: 'Kofi Boateng' },
    { key: 'sarah', name: 'Sarah Boateng' },
  ] as const;

  const emails = PEOPLE.map((p) => `${p.key}@famlink.local`);

  try {
    // Idempotent: clear anything a previous seed left behind.
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(inArray(users.email, emails));

    if (existing.length > 0) {
      const ids = existing.map((u) => u.id);
      // Families are removed explicitly because owner_id is ON DELETE RESTRICT.
      const owned = await db
        .select({ id: families.id })
        .from(families)
        .where(inArray(families.ownerId, ids));

      for (const family of owned) {
        await db.delete(families).where(eq(families.id, family.id));
      }

      await db.delete(users).where(inArray(users.id, ids));
      console.log(`Cleared ${existing.length} existing seed user(s).`);
    }

    const created: Record<string, string> = {};

    for (const person of PEOPLE) {
      const id = randomUUID();
      await db.insert(users).values({
        id,
        name: person.name,
        email: `${person.key}@famlink.local`,
        emailVerified: true,
      });
      created[person.key] = id;
    }

    const family = await createFamily(created.ama!, 'The Boatengs');

    // Join the other two directly; the invitation flow is exercised by tests.
    await db.insert(familyMembers).values([
      { familyId: family.id, userId: created.kofi!, role: 'admin' },
      { familyId: family.id, userId: created.sarah!, role: 'member' },
    ]);

    await db.insert(places).values([
      {
        familyId: family.id,
        createdBy: created.ama!,
        name: 'Home',
        address: 'Accra',
        latitude: 5.6037,
        longitude: -0.187,
        radius: 200,
        icon: 'home',
      },
      {
        familyId: family.id,
        createdBy: created.ama!,
        name: 'School',
        address: 'Accra',
        latitude: 5.615,
        longitude: -0.195,
        radius: 250,
        icon: 'school',
      },
    ]);

    await sendMessage(created.ama!, family.id, 'Dinner at 7 tonight 🍲');
    await sendMessage(created.kofi!, family.id, 'On my way back now');

    console.log('');
    console.log('Seeded "The Boatengs":');
    for (const person of PEOPLE) {
      console.log(`  ${person.name.padEnd(16)} ${person.key}@famlink.local`);
    }
    console.log('');
    console.log('Places: Home, School.  Messages: 2.');
    console.log('');
    console.log('These accounts have NO password — they exist for inspecting the');
    console.log('database and API. Register through the UI to sign in as a real user.');
    console.log('');

    // Nobody is sharing location: the seed must not fabricate consent that
    // was never given, even for fictional people.
    console.log('Location sharing is off for everyone, as it is for real sign-ups.');

    await db.select().from(messages).limit(1);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Seed failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});

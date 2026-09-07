import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });

import { eq } from 'drizzle-orm';
import { db } from '../lib/db';
import { users } from '../lib/db/schema';

/**
 * Grants or withdraws platform admin, from outside the running app.
 *
 * The first admin has to be made this way. There is no bootstrap route and
 * there should not be: an endpoint that can mint the first operator is an
 * endpoint that can mint the second, and it would sit on the public internet
 * for the rest of the app's life guarded by nothing but the hope that nobody
 * tries it. Requiring database access to start the chain means the person who
 * deployed FamLink is the only one who can.
 *
 *   npm run admin:grant -- somebody@example.com
 *   npm run admin:grant -- somebody@example.com --revoke
 */
async function main() {
  const args = process.argv.slice(2);
  const email = args.find((a) => !a.startsWith('--'))?.trim().toLowerCase();
  const revoke = args.includes('--revoke');

  if (!email) {
    console.error('Usage: npm run admin:grant -- <email> [--revoke]');
    process.exit(1);
  }

  const [user] = await db
    .select({ id: users.id, name: users.name, email: users.email, isPlatformAdmin: users.isPlatformAdmin })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (!user) {
    console.error(`No account with the email ${email}.`);
    console.error('They must sign up first — this promotes an existing account.');
    process.exit(1);
  }

  if (user.isPlatformAdmin === !revoke) {
    console.log(`${user.name} <${user.email}> is already ${revoke ? 'not an' : 'an'} admin.`);
    process.exit(0);
  }

  await db
    .update(users)
    .set({ isPlatformAdmin: !revoke, updatedAt: new Date() })
    .where(eq(users.id, user.id));

  console.log(
    revoke
      ? `Removed platform admin from ${user.name} <${user.email}>.`
      : `${user.name} <${user.email}> is now a platform admin. They can reach /admin.`,
  );
  process.exit(0);
}

main().catch((error) => {
  console.error('Failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});

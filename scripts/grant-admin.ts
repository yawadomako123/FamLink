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
 * Talks to Postgres directly rather than through `lib/db`, as `migrate.ts`
 * does. That module is marked `server-only` and reads its configuration at
 * import time — and since ES imports are hoisted above every statement, it
 * would be loaded before this file had a chance to read .env.local.
 *
 *   npm run admin:grant -- somebody@example.com
 *   npm run admin:grant -- somebody@example.com --revoke
 */
import { config as loadEnv } from 'dotenv';
import { Pool } from 'pg';

loadEnv({ path: '.env.local', quiet: true });
loadEnv({ path: '.env', quiet: true });

const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;

if (!url) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env.local first.');
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);
  const email = args.find((a) => !a.startsWith('--'))?.trim().toLowerCase();
  const revoke = args.includes('--revoke');

  if (!email) {
    console.error('Usage: npm run admin:grant -- <email> [--revoke]');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: url,
    // Neon needs TLS; a local container does not offer it.
    ssl: url!.includes('localhost') ? undefined : { rejectUnauthorized: true },
    max: 1,
  });

  try {
    const { rows } = await pool.query<{
      id: string;
      name: string;
      email: string;
      is_platform_admin: boolean;
    }>('select id, name, email, is_platform_admin from users where lower(email) = $1', [email]);

    const user = rows[0];

    if (!user) {
      console.error(`No account with the email ${email}.`);
      console.error('They must sign up first — this promotes an account that already exists.');
      process.exitCode = 1;
      return;
    }

    if (user.is_platform_admin === !revoke) {
      console.log(`${user.name} <${user.email}> is already ${revoke ? 'not an admin' : 'an admin'}.`);
      return;
    }

    await pool.query(
      'update users set is_platform_admin = $1, "updatedAt" = now() where id = $2',
      [!revoke, user.id],
    );

    console.log(
      revoke
        ? `Removed platform admin from ${user.name} <${user.email}>.`
        : `${user.name} <${user.email}> is now a platform admin, and can reach /admin.`,
    );

    const { rows: admins } = await pool.query<{ n: string }>(
      'select count(*) as n from users where is_platform_admin',
    );
    console.log(`Platform admins now: ${admins[0]?.n ?? '?'}`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});

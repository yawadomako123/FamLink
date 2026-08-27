/**
 * Applies pending Drizzle migrations.
 *
 * Uses the direct (unpooled) connection: DDL through PgBouncer in transaction
 * mode is unreliable, and Neon's docs call for the non-pooled endpoint here.
 *
 * Usage: npm run db:migrate
 */
import { config as loadEnv } from 'dotenv';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

loadEnv({ path: '.env.local', quiet: true });
loadEnv({ path: '.env', quiet: true });

const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;

if (!url) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env.local first.');
  process.exit(1);
}

const isLocal = url.includes('localhost') || url.includes('127.0.0.1');

async function main() {
  const pool = new Pool({
    connectionString: url,
    ssl: isLocal ? false : { rejectUnauthorized: true },
    max: 1,
  });

  try {
    const db = drizzle(pool);
    console.log('Applying migrations…');
    await migrate(db, { migrationsFolder: './drizzle' });
    console.log('Migrations up to date.');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});

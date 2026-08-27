import 'server-only';

import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema';
import { serverEnv } from '@/lib/env';

/**
 * Database access.
 *
 * FamLink talks to Neon over the standard Postgres wire protocol rather than
 * the HTTP driver, for two reasons: the realtime stream needs LISTEN/NOTIFY on
 * a real connection, and a plain `pg` pool behaves identically against local
 * Postgres and Neon, so development needs no special-casing.
 *
 * The pool is cached on globalThis because Next.js re-evaluates modules on
 * every hot reload in development, which would otherwise leak connections
 * until Neon starts refusing them.
 */
const globalForDb = globalThis as unknown as {
  __famlinkPool?: Pool;
  __famlinkDb?: NodePgDatabase<typeof schema>;
};

function createPool(): Pool {
  const { DATABASE_URL, NODE_ENV } = serverEnv();

  const pool = new Pool({
    connectionString: DATABASE_URL,
    // Neon terminates TLS at the pooler; local Postgres has none.
    ssl: DATABASE_URL.includes('localhost') || DATABASE_URL.includes('127.0.0.1')
      ? false
      : { rejectUnauthorized: true },
    // Serverless functions are short-lived; a large pool per instance would
    // exhaust Neon's connection budget without improving throughput.
    max: NODE_ENV === 'production' ? 5 : 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  // An unhandled 'error' on an idle client crashes the process by default.
  pool.on('error', (err) => {
    console.error('[db] idle client error', err.message);
  });

  return pool;
}

export const pool: Pool = globalForDb.__famlinkPool ?? createPool();

export const db: NodePgDatabase<typeof schema> =
  globalForDb.__famlinkDb ?? drizzle(pool, { schema });

if (process.env.NODE_ENV !== 'production') {
  globalForDb.__famlinkPool = pool;
  globalForDb.__famlinkDb = db;
}

export { schema };
export * from './schema';

import { config as loadEnv } from 'dotenv';

/**
 * Test environment bootstrap.
 *
 * Authorization tests run against a real Postgres database, because the rules
 * they cover live partly in SQL (transactions, conditional updates, cascades)
 * and a mocked database would prove nothing about them.
 *
 * The database is a dedicated `famlink_test`, never the development one, so a
 * test run cannot destroy local data. Create and migrate it with:
 *
 *   docker exec famlink-postgres psql -U famlink -d postgres \
 *     -c "CREATE DATABASE famlink_test OWNER famlink;"
 *   DATABASE_URL=<test url> npm run db:migrate
 */
loadEnv({ path: '.env.local', quiet: true });
loadEnv({ path: '.env', quiet: true });

const DEFAULT_TEST_URL = 'postgresql://famlink:famlink_dev_password@localhost:5432/famlink_test';

const testUrl = process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_URL;

// Point every database module at the test database, whatever .env.local says.
process.env.DATABASE_URL = testUrl;
process.env.DATABASE_URL_UNPOOLED = testUrl;

// lib/env requires these; supply deterministic values rather than depending on
// whatever the developer happens to have configured.
process.env.BETTER_AUTH_SECRET ??= 'test-secret-value-at-least-32-characters-long';
// NODE_ENV is typed read-only, but Vitest already sets it to 'test'.

/** Guard against ever pointing the suite at a non-test database. */
if (!/famlink_test/.test(testUrl)) {
  throw new Error(
    `Refusing to run tests against "${testUrl}" — the test database name must contain "famlink_test".`,
  );
}

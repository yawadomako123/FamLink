import { z } from 'zod';

/**
 * Validated environment.
 *
 * Anything read here is server-only unless it carries the NEXT_PUBLIC_ prefix.
 * Importing this module from a client component will fail the build, which is
 * the point: it keeps `BETTER_AUTH_SECRET` and the database URLs off the wire.
 */
const serverSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  /**
   * Direct, unpooled connection. LISTEN/NOTIFY does not survive PgBouncer in
   * transaction mode, so the realtime stream needs its own non-pooled URL.
   * Falls back to DATABASE_URL for local development, where both are the same
   * plain Postgres instance.
   */
  DATABASE_URL_UNPOOLED: z.string().min(1).optional(),

  BETTER_AUTH_SECRET: z
    .string()
    .min(32, 'BETTER_AUTH_SECRET must be at least 32 characters — generate with `openssl rand -base64 32`'),
  BETTER_AUTH_URL: z.url().optional(),

  /** Optional: without it, avatar uploads are disabled rather than broken. */
  BLOB_READ_WRITE_TOKEN: z.string().optional(),

  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

let cached: z.infer<typeof serverSchema> | null = null;

export function serverEnv(): z.infer<typeof serverSchema> {
  if (cached) return cached;

  const parsed = serverSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(
      `Invalid environment configuration:\n${issues}\n\nCopy .env.example to .env.local and fill in the values.`,
    );
  }

  cached = parsed.data;
  return cached;
}

/** The connection string the realtime listener must use. */
export function unpooledDatabaseUrl(): string {
  const env = serverEnv();
  return env.DATABASE_URL_UNPOOLED ?? env.DATABASE_URL;
}

export function isAvatarUploadEnabled(): boolean {
  return Boolean(serverEnv().BLOB_READ_WRITE_TOKEN);
}

/* -------------------------------------------------------------------------- */
/* Public configuration — safe to read from the browser.                       */
/* -------------------------------------------------------------------------- */

/**
 * Next.js inlines NEXT_PUBLIC_* at build time only for statically analysable
 * member expressions, so these must be written out in full rather than looked
 * up dynamically.
 */
export const publicEnv = {
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
  mapStyleUrl: process.env.NEXT_PUBLIC_MAP_STYLE_URL ?? '',
} as const;

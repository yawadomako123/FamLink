import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { authedRoute, ok, parseBody } from '@/lib/api/handler';
import { enforceRateLimit } from '@/lib/api/rate-limit';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { nameSchema } from '@/lib/validation/auth';
import { Errors } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ name: nameSchema });

/**
 * PATCH /api/v1/profile — update the caller's display name.
 *
 * Scoped to the session user by construction: the WHERE clause uses the
 * session id, and the request body carries no user id at all.
 */
export const PATCH = authedRoute(async (req, { session }) => {
  enforceRateLimit('mutation', session.user.id);

  const { name } = await parseBody(req, schema);

  const [updated] = await db
    .update(users)
    .set({ name, updatedAt: new Date() })
    .where(eq(users.id, session.user.id))
    .returning({ id: users.id, name: users.name, image: users.image });

  if (!updated) throw Errors.notFound('Your profile');

  return ok({ profile: updated });
});

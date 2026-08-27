import { z } from 'zod';
import { authedRoute, noContent, parseBody } from '@/lib/api/handler';
import { setCurrentFamily } from '@/lib/families/current';
import { Errors } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ familyId: z.uuid() });

/**
 * POST /api/v1/families/current — switch which family the app is showing.
 *
 * setCurrentFamily verifies membership before writing the cookie, so a forged
 * or stale value cannot be persisted through this path either. The cookie is a
 * preference, never an authorization claim.
 */
export const POST = authedRoute(async (req, { session }) => {
  const { familyId } = await parseBody(req, schema);

  const ok = await setCurrentFamily(session.user.id, familyId);
  if (!ok) throw Errors.notFound('That family');

  return noContent();
});

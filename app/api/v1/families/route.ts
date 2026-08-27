import { authedRoute, ok, parseBody } from '@/lib/api/handler';
import { enforceRateLimit } from '@/lib/api/rate-limit';
import { createFamily } from '@/lib/families/service';
import { listUserFamilies } from '@/lib/families/queries';
import { setCurrentFamily } from '@/lib/families/current';
import { createFamilySchema } from '@/lib/validation/family';

export const runtime = 'nodejs';
// Family membership changes must never be served from a cache.
export const dynamic = 'force-dynamic';

/** GET /api/v1/families — families the caller belongs to. */
export const GET = authedRoute(async (_req, { session }) => {
  const families = await listUserFamilies(session.user.id);
  return ok({ families });
});

/** POST /api/v1/families — create a family, with the caller as owner. */
export const POST = authedRoute(async (req, { session }) => {
  enforceRateLimit('mutation', session.user.id);

  const { name } = await parseBody(req, createFamilySchema);
  const family = await createFamily(session.user.id, name);

  // Switch the user to the family they just made.
  await setCurrentFamily(session.user.id, family.id);

  return ok({ family }, { status: 201 });
});

import { authedRoute, noContent } from '@/lib/api/handler';
import { enforceRateLimit } from '@/lib/api/rate-limit';
import { leaveFamily } from '@/lib/families/service';
import { clearCurrentFamily } from '@/lib/families/current';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/families/:familyId/leave
 *
 * A POST rather than a DELETE on the membership: leaving is an action taken on
 * yourself, and keeping it distinct from "remove a member" means the two can
 * never be confused by a mistyped route.
 */
export const POST = authedRoute<{ familyId: string }>(async (_req, { params, session }) => {
  enforceRateLimit('mutation', session.user.id);

  const { familyId } = await params;
  await leaveFamily(session.user.id, familyId);

  // The remembered family is gone; fall back to whatever remains.
  await clearCurrentFamily();

  return noContent();
});

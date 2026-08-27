import { authedRoute, ok } from '@/lib/api/handler';
import { listFamilyMembers } from '@/lib/families/queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/families/:familyId/members
 *
 * Returns each member's sharing *state* but never their coordinates. Knowing
 * that somebody shares their location is not the same as knowing where they
 * are; locations are served separately and gated by the visibility rule.
 */
export const GET = authedRoute<{ familyId: string }>(async (_req, { params, session }) => {
  const { familyId } = await params;
  const members = await listFamilyMembers(session.user.id, familyId);
  return ok({ members });
});

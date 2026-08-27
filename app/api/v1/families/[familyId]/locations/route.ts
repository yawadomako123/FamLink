import { authedRoute, ok } from '@/lib/api/handler';
import { getFamilyLocations } from '@/lib/location/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/families/:familyId/locations — positions for the family map.
 *
 * Returns only members the caller is permitted to see. Members whose location
 * is withheld are listed separately with a reason, so the UI can be explicit
 * about who is not sharing instead of silently omitting them.
 */
export const GET = authedRoute<{ familyId: string }>(async (_req, { params, session }) => {
  const { familyId } = await params;
  const result = await getFamilyLocations(session.user.id, familyId);

  return ok(result);
});

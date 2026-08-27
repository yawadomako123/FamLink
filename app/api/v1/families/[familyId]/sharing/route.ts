import { authedRoute, ok, parseBody } from '@/lib/api/handler';
import { enforceRateLimit } from '@/lib/api/rate-limit';
import { updateSharingSettings } from '@/lib/location/service';
import { updateSharingSchema } from '@/lib/validation/location';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH /api/v1/families/:familyId/sharing
 *
 * Changes the *caller's own* sharing settings. There is deliberately no
 * endpoint for changing anyone else's: location sharing is a decision only its
 * owner may make, including for a family owner or admin.
 */
export const PATCH = authedRoute<{ familyId: string }>(async (req, { params, session }) => {
  enforceRateLimit('mutation', session.user.id);

  const { familyId } = await params;
  const changes = await parseBody(req, updateSharingSchema);

  const settings = await updateSharingSettings(session.user.id, familyId, changes);
  return ok({ sharing: settings });
});

import { authedRoute, noContent, ok, parseBody } from '@/lib/api/handler';
import { enforceRateLimit } from '@/lib/api/rate-limit';
import { deletePlace, updatePlace } from '@/lib/places/service';
import { updatePlaceSchema } from '@/lib/validation/places';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { familyId: string; placeId: string };

/**
 * PATCH — edit a place. Restricted to its creator or a family admin, so a
 * member cannot quietly move "School" somewhere else.
 */
export const PATCH = authedRoute<Params>(async (req, { params, session }) => {
  enforceRateLimit('mutation', session.user.id);

  const { familyId, placeId } = await params;
  const input = await parseBody(req, updatePlaceSchema);

  const place = await updatePlace(session.user.id, familyId, placeId, input);
  return ok({ place });
});

/** DELETE — remove a place, its geofence state and its event history. */
export const DELETE = authedRoute<Params>(async (_req, { params, session }) => {
  enforceRateLimit('mutation', session.user.id);

  const { familyId, placeId } = await params;
  await deletePlace(session.user.id, familyId, placeId);

  return noContent();
});

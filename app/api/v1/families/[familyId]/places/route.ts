import { authedRoute, ok, parseBody } from '@/lib/api/handler';
import { enforceRateLimit } from '@/lib/api/rate-limit';
import { createPlace, listPlaces } from '@/lib/places/service';
import { createPlaceSchema } from '@/lib/validation/places';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET — the family's places. Any member may read them. */
export const GET = authedRoute<{ familyId: string }>(async (_req, { params, session }) => {
  const { familyId } = await params;
  const places = await listPlaces(session.user.id, familyId);
  return ok({ places });
});

/**
 * POST — add a place.
 *
 * Open to any member: places are shared family furniture, and requiring an
 * admin to add "Grandma's house" would make the feature unused.
 */
export const POST = authedRoute<{ familyId: string }>(async (req, { params, session }) => {
  enforceRateLimit('mutation', session.user.id);

  const { familyId } = await params;
  const input = await parseBody(req, createPlaceSchema);

  const place = await createPlace(session.user.id, familyId, input);
  return ok({ place }, { status: 201 });
});

import { authedRoute, ok } from '@/lib/api/handler';
import { listPlaceEvents } from '@/lib/places/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET — recent arrivals and departures for the family.
 *
 * Events name a place, not a coordinate. "Sarah arrived at School" tells the
 * family what they need without disclosing a position to someone who would not
 * otherwise be allowed to see it.
 */
export const GET = authedRoute<{ familyId: string }>(async (_req, { params, session }) => {
  const { familyId } = await params;
  const events = await listPlaceEvents(session.user.id, familyId);
  return ok({ events });
});

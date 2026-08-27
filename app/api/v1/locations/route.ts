import { authedRoute, ok, parseBody } from '@/lib/api/handler';
import { enforceRateLimit } from '@/lib/api/rate-limit';
import { recordLocation } from '@/lib/location/service';
import { locationUpdateSchema } from '@/lib/validation/location';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/locations — record the caller's current position.
 *
 * The endpoint a future native client posts to as well, which is why the
 * family is named in the body rather than the path: one background task can
 * report to whichever family the user is actively sharing with.
 *
 * Refuses unless the caller's sharing state for that family is `sharing`. The
 * client throttles before calling, but the server never assumes it did.
 */
export const POST = authedRoute(async (req, { session }) => {
  enforceRateLimit('locationUpdate', session.user.id);

  const input = await parseBody(req, locationUpdateSchema);
  const result = await recordLocation(session.user.id, input);

  return ok({ recordedAt: result.recordedAt }, { status: 201 });
});

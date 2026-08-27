import { z } from 'zod';
import { authedRoute, ok, parseBody } from '@/lib/api/handler';
import { enforceRateLimit } from '@/lib/api/rate-limit';
import { listActiveEmergencies, triggerSos } from '@/lib/notifications/emergency';
import { latitudeSchema, longitudeSchema, accuracySchema } from '@/lib/validation/location';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Location is optional. If the device cannot get a fix in time, the alert
 * still goes out — "needs help, location unavailable" beats no alert.
 */
const schema = z.object({
  latitude: latitudeSchema.optional(),
  longitude: longitudeSchema.optional(),
  accuracy: accuracySchema,
});

/** GET — currently active emergencies for this family. */
export const GET = authedRoute<{ familyId: string }>(async (_req, { params, session }) => {
  const { familyId } = await params;
  const emergencies = await listActiveEmergencies(session.user.id, familyId);
  return ok({ emergencies });
});

/**
 * POST — raise an SOS.
 *
 * Rate limited, but generously: repeatedly pressing the button in a genuine
 * emergency must not be throttled into silence.
 */
export const POST = authedRoute<{ familyId: string }>(async (req, { params, session }) => {
  enforceRateLimit('sos', session.user.id);

  const { familyId } = await params;
  const body = await parseBody(req, schema);

  const emergency = await triggerSos(session.user.id, { familyId, ...body });

  return ok({ emergency }, { status: 201 });
});

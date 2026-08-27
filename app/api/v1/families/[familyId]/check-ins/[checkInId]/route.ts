import { z } from 'zod';
import { authedRoute, ok, parseBody } from '@/lib/api/handler';
import { enforceRateLimit } from '@/lib/api/rate-limit';
import { respondToCheckIn } from '@/lib/checkins/service';
import { latitudeSchema, longitudeSchema } from '@/lib/validation/location';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Position is optional and supplied per reply. Answering a check-in never
 * changes the responder's standing sharing settings — attaching a location is
 * a one-off decision made at the moment they answer.
 */
const schema = z.object({
  reply: z.enum(['ok', 'need_help']),
  latitude: latitudeSchema.optional(),
  longitude: longitudeSchema.optional(),
});

export const POST = authedRoute<{ familyId: string; checkInId: string }>(
  async (req, { params, session }) => {
    enforceRateLimit('mutation', session.user.id);

    const { familyId, checkInId } = await params;
    const { reply, latitude, longitude } = await parseBody(req, schema);

    const position =
      latitude !== undefined && longitude !== undefined
        ? { latitude, longitude }
        : undefined;

    const checkIn = await respondToCheckIn(
      session.user.id,
      familyId,
      checkInId,
      reply,
      position,
    );

    return ok({ checkIn });
  },
);

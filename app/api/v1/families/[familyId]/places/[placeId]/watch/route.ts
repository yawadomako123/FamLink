import { z } from 'zod';
import { authedRoute, ok, parseBody } from '@/lib/api/handler';
import { enforceRateLimit } from '@/lib/api/rate-limit';
import { setPlaceWatch } from '@/lib/places/watches';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z
  .object({
    arrivals: z.boolean().optional(),
    departures: z.boolean().optional(),
  })
  .refine((v) => v.arrivals !== undefined || v.departures !== undefined, {
    message: 'Provide arrivals, departures, or both.',
  });

/**
 * PUT — whether the caller hears about this place.
 *
 * Only ever the caller's own filter. There is deliberately no endpoint for
 * changing anyone else's: what somebody is told about their family is theirs
 * to decide, including for an owner or admin.
 */
export const PUT = authedRoute<{ familyId: string; placeId: string }>(
  async (req, { params, session }) => {
    enforceRateLimit('mutation', session.user.id);

    const { familyId, placeId } = await params;
    const changes = await parseBody(req, schema);

    const watch = await setPlaceWatch(session.user.id, familyId, placeId, changes);
    return ok({ watch });
  },
);

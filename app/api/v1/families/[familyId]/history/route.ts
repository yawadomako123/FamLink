import { z } from 'zod';
import { authedRoute, ok, parseQuery } from '@/lib/api/handler';
import { getOwnHistory } from '@/lib/location/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const querySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date as YYYY-MM-DD.')
    .optional(),
  /**
   * Minutes that local time is behind UTC, as returned by
   * `Date.prototype.getTimezoneOffset`. Sent by the client so a "day" is
   * bucketed in the viewer's timezone rather than the server's.
   */
  timezoneOffset: z.coerce.number().int().min(-840).max(840).default(0),
});

/**
 * GET /api/v1/families/:familyId/history — the caller's OWN history.
 *
 * There is no parameter for whose history to fetch, and that is deliberate: it
 * makes it impossible for a caller to request another member's timeline, by
 * accident or otherwise. Family-wide history is a later feature with its own
 * consent model, not something to be reached by passing a different id here.
 */
export const GET = authedRoute<{ familyId: string }>(async (req, { params, session }) => {
  const { familyId } = await params;
  const { date, timezoneOffset } = parseQuery(req, querySchema);

  // Build the local day's boundaries, then shift into UTC for the query.
  const base = date ? new Date(`${date}T00:00:00Z`) : new Date();
  const localMidnightUtc = date
    ? new Date(base.getTime() + timezoneOffset * 60_000)
    : startOfLocalDay(base, timezoneOffset);

  const from = localMidnightUtc;
  const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);

  const points = await getOwnHistory(session.user.id, familyId, { from, to });

  return ok({
    from,
    to,
    points,
  });
});

/** Midnight of the viewer's current local day, expressed in UTC. */
function startOfLocalDay(now: Date, timezoneOffsetMinutes: number): Date {
  const local = new Date(now.getTime() - timezoneOffsetMinutes * 60_000);
  const midnightLocal = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
  );
  return new Date(midnightLocal + timezoneOffsetMinutes * 60_000);
}

import { z } from 'zod';
import { authedRoute, ok, parseBody } from '@/lib/api/handler';
import { enforceRateLimit } from '@/lib/api/rate-limit';
import { getPreferences, updatePreferences } from '@/lib/notifications/preferences';
import { requireMembership } from '@/lib/permissions/family';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Minutes past local midnight. */
const minuteOfDay = z.number().int().min(0).max(1439);

/*
 * There is deliberately no `sos` field: an emergency alert is not something a
 * member may switch off for themselves.
 *
 * `.strict()` matters here. Zod's default is to strip unknown keys, so a
 * request to mute SOS would parse to an empty object and return 200 — telling
 * the caller it worked when nothing was stored. Nothing was ever mutable, but
 * an API that answers "done" to a request it refuses is lying. Strict mode
 * makes the refusal explicit.
 */
const schema = z.strictObject({
  arrivals: z.boolean().optional(),
  departures: z.boolean().optional(),
  sharingChanges: z.boolean().optional(),
  lowBattery: z.boolean().optional(),
  chatMessages: z.boolean().optional(),
  checkIns: z.boolean().optional(),
  quietHoursStart: minuteOfDay.nullable().optional(),
  quietHoursEnd: minuteOfDay.nullable().optional(),
});

export const GET = authedRoute<{ familyId: string }>(async (_req, { params, session }) => {
  const { familyId } = await params;
  await requireMembership(session.user.id, familyId);

  const preferences = await getPreferences(session.user.id, familyId);
  return ok({ preferences });
});

export const PATCH = authedRoute<{ familyId: string }>(async (req, { params, session }) => {
  enforceRateLimit('mutation', session.user.id);

  const { familyId } = await params;
  const changes = await parseBody(req, schema);

  const preferences = await updatePreferences(session.user.id, familyId, changes);
  return ok({ preferences });
});

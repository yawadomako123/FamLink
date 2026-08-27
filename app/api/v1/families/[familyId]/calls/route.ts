import { z } from 'zod';
import { authedRoute, ok, parseBody } from '@/lib/api/handler';
import { enforceRateLimit } from '@/lib/api/rate-limit';
import { getActiveCall, listRecentCalls, startCall } from '@/lib/calls/service';
import { buildIceConfig } from '@/lib/calls/ice';
import { turnConfig } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ kind: z.enum(['audio', 'video']) });

/**
 * GET — the family's current call, recent history, and ICE configuration.
 *
 * ICE is returned here rather than baked into the client bundle so TURN
 * credentials stay server-side and can be rotated without a redeploy.
 */
export const GET = authedRoute<{ familyId: string }>(async (_req, { params, session }) => {
  const { familyId } = await params;

  const [active, recent] = await Promise.all([
    getActiveCall(session.user.id, familyId),
    listRecentCalls(session.user.id, familyId),
  ]);

  return ok({ active, recent, ice: buildIceConfig(turnConfig()) });
});

/** POST — start a call, or join the one already in progress. */
export const POST = authedRoute<{ familyId: string }>(async (req, { params, session }) => {
  enforceRateLimit('mutation', session.user.id);

  const { familyId } = await params;
  const { kind } = await parseBody(req, schema);

  const call = await startCall(session.user.id, familyId, kind);

  return ok({ call, ice: buildIceConfig(turnConfig()) }, { status: 201 });
});

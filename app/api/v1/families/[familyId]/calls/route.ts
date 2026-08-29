import { z } from 'zod';
import { authedRoute, ok, parseBody } from '@/lib/api/handler';
import { enforceRateLimit } from '@/lib/api/rate-limit';
import { getActiveCall, listRecentCalls, startCall } from '@/lib/calls/service';
import { buildIceConfig } from '@/lib/calls/ice';
import { issueTurnCredentials } from '@/lib/calls/turn';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  kind: z.enum(['audio', 'video']),
  /**
   * Who to ring. Omitted rings the whole family; naming people makes the call
   * private to them. Capped so a malformed request cannot ask the server to
   * validate an unbounded list.
   */
  inviteeIds: z.array(z.string().min(1)).min(1).max(8).optional(),
});

/**
 * GET — the family's current call, recent history, and ICE configuration.
 *
 * ICE is issued per request rather than baked into the client bundle. TURN
 * credentials are short-lived and derived from a shared secret that never
 * leaves the server, so a credential captured from the wire expires on its own
 * and cannot be reused indefinitely.
 */
export const GET = authedRoute<{ familyId: string }>(async (_req, { params, session }) => {
  const { familyId } = await params;

  const [active, recent] = await Promise.all([
    getActiveCall(session.user.id, familyId),
    listRecentCalls(session.user.id, familyId),
  ]);

  return ok({ active, recent, ice: buildIceConfig(issueTurnCredentials(session.user.id)) });
});

/** POST — start a call, or join the one already in progress. */
export const POST = authedRoute<{ familyId: string }>(async (req, { params, session }) => {
  enforceRateLimit('mutation', session.user.id);

  const { familyId } = await params;
  const { kind, inviteeIds } = await parseBody(req, schema);

  const call = await startCall(session.user.id, familyId, kind, inviteeIds);

  return ok({ call, ice: buildIceConfig(issueTurnCredentials(session.user.id)) }, { status: 201 });
});

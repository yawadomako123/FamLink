import { z } from 'zod';
import { authedRoute, noContent, ok, parseBody } from '@/lib/api/handler';
import { declineCall, endCall, getCall, joinCall, leaveCall } from '@/lib/calls/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { familyId: string; callId: string };

const schema = z.object({ action: z.enum(['join', 'leave', 'decline', 'end']) });

export const GET = authedRoute<Params>(async (_req, { params, session }) => {
  const { familyId, callId } = await params;
  const call = await getCall(session.user.id, familyId, callId);
  return ok({ call });
});

/**
 * POST — act on a call.
 *
 * `decline` only silences it for the caller; the rest of the family keeps
 * ringing. `end` finishes it for everyone, and `leave` does that implicitly
 * when the last participant drops.
 */
export const POST = authedRoute<Params>(async (req, { params, session }) => {
  const { familyId, callId } = await params;
  const { action } = await parseBody(req, schema);

  switch (action) {
    case 'join':
      return ok({ call: await joinCall(session.user.id, familyId, callId) });
    case 'leave':
      await leaveCall(session.user.id, familyId, callId);
      return noContent();
    case 'decline':
      await declineCall(session.user.id, familyId, callId);
      return noContent();
    case 'end':
      await endCall(session.user.id, familyId, callId);
      return noContent();
  }
});

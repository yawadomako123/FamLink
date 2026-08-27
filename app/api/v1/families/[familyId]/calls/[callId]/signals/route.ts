import { z } from 'zod';
import { authedRoute, noContent, ok, parseBody, parseQuery } from '@/lib/api/handler';
import { pollSignals, sendSignal } from '@/lib/calls/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { familyId: string; callId: string };

const postSchema = z.object({
  toUserId: z.string().min(1).optional(),
  kind: z.enum(['offer', 'answer', 'ice', 'renegotiate']),
  // SDP and ICE candidates are opaque to us; the browser validates them.
  payload: z.record(z.string(), z.unknown()),
});

const getSchema = z.object({ after: z.coerce.number().int().min(0).default(0) });

/**
 * GET — signalling messages addressed to the caller since a cursor.
 *
 * A cursor rather than a timestamp: ICE candidates arrive in bursts and two in
 * the same millisecond would be indistinguishable by time.
 */
export const GET = authedRoute<Params>(async (req, { params, session }) => {
  const { familyId, callId } = await params;
  const { after } = parseQuery(req, getSchema);

  const signals = await pollSignals(session.user.id, familyId, callId, after);
  return ok({ signals });
});

/** POST — relay an offer, answer or ICE candidate to a peer. */
export const POST = authedRoute<Params>(async (req, { params, session }) => {
  const { familyId, callId } = await params;
  const body = await parseBody(req, postSchema);

  await sendSignal(session.user.id, familyId, callId, {
    toUserId: body.toUserId,
    kind: body.kind,
    payload: body.payload as Record<string, unknown>,
  });

  return noContent();
});

import { authedRoute, noContent } from '@/lib/api/handler';
import { announceTyping } from '@/lib/chat/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST — say that the caller is composing a message.
 *
 * Nothing is stored. The hint goes straight onto the realtime channel and is
 * forgotten; a client that misses one shows no indicator for a second or two,
 * which is the correct cost for something this disposable.
 *
 * Not rate limited through `enforceRateLimit`: the client already throttles to
 * one call every few seconds, and a 429 here would be logged as an error for
 * something that does not matter. The work is a single NOTIFY.
 */
export const POST = authedRoute<{ familyId: string }>(async (_req, { params, session }) => {
  const { familyId } = await params;

  await announceTyping(session.user.id, familyId);

  return noContent();
});

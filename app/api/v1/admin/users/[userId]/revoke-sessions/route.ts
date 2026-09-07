import { authedRoute, ok } from '@/lib/api/handler';
import { revokeSessions } from '@/lib/admin/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST — end every session this person holds.
 *
 * Authorization is the service's, not this route's. `revokeSessions` calls
 * `requirePlatformAdmin` itself, so the check cannot be lost by a future route
 * that forgets to make it.
 */
export const POST = authedRoute<{ userId: string }>(async (_req, { params }) => {
  const { userId } = await params;
  const ended = await revokeSessions(userId);

  return ok({ ended });
});

import { authedRoute, ok } from '@/lib/api/handler';
import { findCallForUser } from '@/lib/calls/service';
import { buildIceConfig } from '@/lib/calls/ice';
import { issueTurnCredentials } from '@/lib/calls/turn';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET — any call ringing for the caller, in any family they belong to.
 *
 * Deliberately not scoped to a family. The in-app ring is mounted against
 * whichever family is on screen, so a call in another one only ever produced a
 * push notification — and the 45-second ring had usually timed out before
 * anybody noticed and switched. This is what lets the ring follow the person
 * rather than the page.
 */
export const GET = authedRoute(async (_req, { session }) => {
  const found = await findCallForUser(session.user.id);

  return ok({
    active: found?.call ?? null,
    familyId: found?.familyId ?? null,
    familyName: found?.familyName ?? null,
    ice: buildIceConfig(issueTurnCredentials(session.user.id)),
  });
});

import { authedRoute, noContent } from '@/lib/api/handler';
import { enforceRateLimit } from '@/lib/api/rate-limit';
import { stopSharingAndForget } from '@/lib/location/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/families/:familyId/sharing/forget
 *
 * Switches sharing off and erases the caller's stored history for this family.
 * Separate from the ordinary off switch because it is irreversible, and
 * turning sharing off should not silently destroy someone's own records.
 */
export const POST = authedRoute<{ familyId: string }>(async (_req, { params, session }) => {
  enforceRateLimit('mutation', session.user.id);

  const { familyId } = await params;
  await stopSharingAndForget(session.user.id, familyId);

  return noContent();
});

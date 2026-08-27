import { z } from 'zod';
import { authedRoute, noContent, parseBody } from '@/lib/api/handler';
import { enforceRateLimit } from '@/lib/api/rate-limit';
import { cancelSos, resolveSos } from '@/lib/notifications/emergency';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ action: z.enum(['resolve', 'cancel']) });

/**
 * POST — resolve or cancel an emergency.
 *
 * Any member may resolve: somebody in trouble may be in no position to clear
 * their own alert. Only the sender may cancel it as a false alarm, which the
 * service layer enforces.
 */
export const POST = authedRoute<{ familyId: string; emergencyId: string }>(
  async (req, { params, session }) => {
    enforceRateLimit('mutation', session.user.id);

    const { familyId, emergencyId } = await params;
    const { action } = await parseBody(req, schema);

    if (action === 'cancel') {
      await cancelSos(session.user.id, familyId, emergencyId);
    } else {
      await resolveSos(session.user.id, familyId, emergencyId);
    }

    return noContent();
  },
);

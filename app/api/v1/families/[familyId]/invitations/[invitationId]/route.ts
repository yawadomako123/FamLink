import { authedRoute, noContent } from '@/lib/api/handler';
import { enforceRateLimit } from '@/lib/api/rate-limit';
import { revokeInvitation } from '@/lib/families/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** DELETE — revoke an unused invitation. Admin or owner only. */
export const DELETE = authedRoute<{ familyId: string; invitationId: string }>(
  async (_req, { params, session }) => {
    enforceRateLimit('mutation', session.user.id);

    const { familyId, invitationId } = await params;
    await revokeInvitation(session.user.id, familyId, invitationId);

    return noContent();
  },
);

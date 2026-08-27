import { authedRoute, noContent } from '@/lib/api/handler';
import { enforceRateLimit } from '@/lib/api/rate-limit';
import { deleteMessage } from '@/lib/chat/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * DELETE — soft-delete a message.
 *
 * Senders may remove their own; owners and admins may remove anyone's, which
 * is the moderation the brief asks for without building a moderation system.
 */
export const DELETE = authedRoute<{ familyId: string; messageId: string }>(
  async (_req, { params, session }) => {
    enforceRateLimit('mutation', session.user.id);

    const { familyId, messageId } = await params;
    await deleteMessage(session.user.id, familyId, messageId);

    return noContent();
  },
);

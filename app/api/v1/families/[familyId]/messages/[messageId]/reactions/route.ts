import { z } from 'zod';
import { authedRoute, noContent, parseBody } from '@/lib/api/handler';
import { enforceRateLimit } from '@/lib/api/rate-limit';
import { ALLOWED_REACTIONS, reactToMessage } from '@/lib/chat/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// A closed set rather than free-text: predictable data, nothing arbitrary to
// sanitise wherever it renders.
const schema = z.object({ emoji: z.enum(ALLOWED_REACTIONS) });

/** POST — react to a message. Sending the same emoji again removes it. */
export const POST = authedRoute<{ familyId: string; messageId: string }>(
  async (req, { params, session }) => {
    enforceRateLimit('message', session.user.id);

    const { familyId, messageId } = await params;
    const { emoji } = await parseBody(req, schema);

    await reactToMessage(session.user.id, familyId, messageId, emoji);
    return noContent();
  },
);

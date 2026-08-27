import { z } from 'zod';
import { authedRoute, ok, parseBody, parseQuery } from '@/lib/api/handler';
import { enforceRateLimit } from '@/lib/api/rate-limit';
import {
  countUnreadMessages,
  getReactions,
  listMessages,
  listMessagesSince,
  sendMessage,
} from '@/lib/chat/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const querySchema = z.object({
  /** Page backwards through history. */
  before: z.iso.datetime().optional(),
  /** Fetch only what arrived after this, for appending on a realtime hint. */
  since: z.iso.datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const sendSchema = z.object({ content: z.string().min(1).max(2000) });

export const GET = authedRoute<{ familyId: string }>(async (req, { params, session }) => {
  const { familyId } = await params;
  const { before, since, limit } = parseQuery(req, querySchema);

  // `since` appends after a realtime hint; the default path loads a page of
  // recent history.
  const items = since
    ? await listMessagesSince(session.user.id, familyId, new Date(since))
    : await listMessages(session.user.id, familyId, {
        ...(limit !== undefined ? { limit } : {}),
        ...(before ? { before: new Date(before) } : {}),
      });

  const [unread, reactions] = await Promise.all([
    countUnreadMessages(session.user.id, familyId),
    getReactions(
      session.user.id,
      familyId,
      items.map((m) => m.id),
    ),
  ]);

  return ok({
    messages: items.map((m) => ({ ...m, reactions: reactions.get(m.id) ?? [] })),
    unread,
    append: Boolean(since),
  });
});

export const POST = authedRoute<{ familyId: string }>(async (req, { params, session }) => {
  enforceRateLimit('message', session.user.id);

  const { familyId } = await params;
  const { content } = await parseBody(req, sendSchema);

  const message = await sendMessage(session.user.id, familyId, content);

  return ok({ message }, { status: 201 });
});

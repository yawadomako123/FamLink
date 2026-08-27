import { z } from 'zod';
import { authedRoute, ok, parseBody } from '@/lib/api/handler';
import { enforceRateLimit } from '@/lib/api/rate-limit';
import { markRead } from '@/lib/notifications/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Omit `ids` to mark everything in this family read. */
const schema = z.object({ ids: z.array(z.uuid()).max(200).optional() });

export const POST = authedRoute<{ familyId: string }>(async (req, { params, session }) => {
  enforceRateLimit('mutation', session.user.id);

  const { familyId } = await params;
  const { ids } = await parseBody(req, schema);

  // Supplying somebody else's notification ids updates zero rows: the query is
  // scoped by the session user as well as the ids.
  const count = await markRead(session.user.id, familyId, ids);

  return ok({ markedRead: count });
});

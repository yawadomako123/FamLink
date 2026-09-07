import { z } from 'zod';
import { authedRoute, noContent, parseBody } from '@/lib/api/handler';
import { setPlatformAdmin } from '@/lib/admin/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ value: z.boolean() });

/**
 * POST — grant or withdraw platform admin.
 *
 * Explicit `value` rather than a toggle. A toggle derived from what the client
 * last saw will eventually flip the wrong way when two operators are looking
 * at the same list, and this is not a decision to get wrong by a race.
 */
export const POST = authedRoute<{ userId: string }>(async (req, { params }) => {
  const { userId } = await params;
  const { value } = await parseBody(req, schema);

  await setPlatformAdmin(userId, value);

  return noContent();
});

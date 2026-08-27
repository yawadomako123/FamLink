import { z } from 'zod';
import { authedRoute, noContent, parseBody } from '@/lib/api/handler';
import { enforceRateLimit } from '@/lib/api/rate-limit';
import { transferOwnership } from '@/lib/families/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ userId: z.string().min(1) });

/**
 * POST /api/v1/families/:familyId/transfer-ownership
 *
 * Separate from the role endpoint because ownership is single-holder: handing
 * it over simultaneously demotes the caller, which is not what "set role" means.
 */
export const POST = authedRoute<{ familyId: string }>(async (req, { params, session }) => {
  enforceRateLimit('mutation', session.user.id);

  const { familyId } = await params;
  const { userId } = await parseBody(req, schema);

  await transferOwnership(session.user.id, familyId, userId);
  return noContent();
});

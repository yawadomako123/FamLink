import { z } from 'zod';
import { authedRoute, ok, parseBody } from '@/lib/api/handler';
import { enforceRateLimit } from '@/lib/api/rate-limit';
import { acceptInvitation } from '@/lib/families/service';
import { setCurrentFamily } from '@/lib/families/current';
import { invitationCodeSchema } from '@/lib/validation/family';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ code: invitationCodeSchema });

/**
 * POST /api/v1/invitations/accept — redeem a code and join the family.
 *
 * Rate limited against code guessing: 40 bits of entropy plus this budget puts
 * brute force out of reach.
 */
export const POST = authedRoute(async (req, { session }) => {
  enforceRateLimit('invitation', session.user.id);

  const { code } = await parseBody(req, schema);
  const result = await acceptInvitation(session.user.id, code);

  await setCurrentFamily(session.user.id, result.familyId);

  return ok({ family: result }, { status: 201 });
});

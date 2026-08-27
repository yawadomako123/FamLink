import { authedRoute, noContent, ok, parseBody } from '@/lib/api/handler';
import { enforceRateLimit } from '@/lib/api/rate-limit';
import { removeMember, updateMemberRole } from '@/lib/families/service';
import { updateMemberRoleSchema } from '@/lib/validation/family';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { familyId: string; userId: string };

/**
 * PATCH /api/v1/families/:familyId/members/:userId — change a member's role.
 * Owner only; the service layer enforces that, not this handler.
 */
export const PATCH = authedRoute<Params>(async (req, { params, session }) => {
  enforceRateLimit('mutation', session.user.id);

  const { familyId, userId } = await params;
  const { role } = await parseBody(req, updateMemberRoleSchema);

  const member = await updateMemberRole(session.user.id, familyId, userId, role);
  return ok({ member });
});

/** DELETE /api/v1/families/:familyId/members/:userId — remove a member. */
export const DELETE = authedRoute<Params>(async (_req, { params, session }) => {
  enforceRateLimit('mutation', session.user.id);

  const { familyId, userId } = await params;
  await removeMember(session.user.id, familyId, userId);

  return noContent();
});

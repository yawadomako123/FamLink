import { authedRoute, ok } from '@/lib/api/handler';
import { previewInvitation } from '@/lib/families/service';
import { invitationCodeSchema } from '@/lib/validation/family';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/invitations/:code — what this invitation is for.
 *
 * Requires a signed-in caller. An anonymous preview would let anyone brute-force
 * codes to discover family names, and there is no product reason to see an
 * invitation before you have an account.
 *
 * Reveals only the family name, who invited you and the member count — enough
 * to decide whether to accept, nothing about where anyone is.
 */
export const GET = authedRoute<{ code: string }>(async (_req, { params, session }) => {
  const { code } = await params;
  const parsed = invitationCodeSchema.parse(code);

  const preview = await previewInvitation(session.user.id, parsed);
  return ok({ invitation: preview });
});

import { authedRoute, ok, parseBody } from '@/lib/api/handler';
import { enforceRateLimit } from '@/lib/api/rate-limit';
import { listFamilyInvitations } from '@/lib/families/queries';
import { createInvitation } from '@/lib/families/service';
import { createInvitationSchema } from '@/lib/validation/family';
import { invitationUrl } from '@/lib/families/invitations';
import { publicEnv } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET — open invitations for the family. Admin or owner only.
 *
 * Metadata only. The code is unrecoverable once created, so no link can be
 * rebuilt here; an admin who has lost one revokes it and issues another.
 */
export const GET = authedRoute<{ familyId: string }>(async (_req, { params, session }) => {
  const { familyId } = await params;
  const invitations = await listFamilyInvitations(session.user.id, familyId);

  return ok({ invitations });
});

/**
 * POST — mint a new invitation code. Admin or owner only.
 *
 * This is the only moment the plaintext code exists outside the client's
 * clipboard, so the response carries the full join URL.
 */
export const POST = authedRoute<{ familyId: string }>(async (req, { params, session }) => {
  // Tighter budget than ordinary mutations: invitations are the one thing that
  // grants access to a family.
  enforceRateLimit('invitation', session.user.id);

  const { familyId } = await params;
  const body = await parseBody(req, createInvitationSchema);

  const invitation = await createInvitation(session.user.id, familyId, body);

  return ok(
    { invitation: { ...invitation, url: invitationUrl(invitation.code, publicEnv.appUrl) } },
    { status: 201 },
  );
});

import { authedRoute, noContent } from '@/lib/api/handler';
import { markThreadRead } from '@/lib/chat/service';
import { requireMembership } from '@/lib/permissions/family';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST — move this member's read high-water mark to now. */
export const POST = authedRoute<{ familyId: string }>(async (_req, { params, session }) => {
  const { familyId } = await params;

  // markThreadRead is an upsert with no membership check of its own, so the
  // guard belongs here.
  await requireMembership(session.user.id, familyId);
  await markThreadRead(session.user.id, familyId);

  return noContent();
});

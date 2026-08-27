import { authedRoute, ok } from '@/lib/api/handler';
import { countUnread, listNotifications } from '@/lib/notifications/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET — the caller's own notifications for this family.
 *
 * There is no parameter for whose notifications to read; the caller's id comes
 * from the session, so another member's cannot be requested.
 */
export const GET = authedRoute<{ familyId: string }>(async (_req, { params, session }) => {
  const { familyId } = await params;

  const [items, unread] = await Promise.all([
    listNotifications(session.user.id, familyId),
    countUnread(session.user.id, familyId),
  ]);

  return ok({ notifications: items, unread });
});

import 'server-only';

import { resolveCurrentFamily } from './current';
import { countUnread } from '@/lib/notifications/service';
import { countUnreadMessages } from '@/lib/chat/service';
import type { FamilySummary } from './queries';

/**
 * Everything the app chrome needs, resolved once per page.
 *
 * Pages previously each fetched their own subset, which is how the chat badge
 * ended up never being passed at all — the sidebar accepted an
 * `unreadMessages` prop that no caller supplied. Centralising it means a badge
 * cannot silently go missing from one route.
 */
export interface ShellData {
  family: FamilySummary | null;
  families: FamilySummary[];
  alertCount: number;
  unreadMessages: number;
}

export async function resolveShellData(userId: string): Promise<ShellData> {
  const { current, families } = await resolveCurrentFamily(userId);

  if (!current) {
    return { family: null, families, alertCount: 0, unreadMessages: 0 };
  }

  const [alertCount, unreadMessages] = await Promise.all([
    countUnread(userId, current.id),
    countUnreadMessages(userId, current.id),
  ]);

  return { family: current, families, alertCount, unreadMessages };
}

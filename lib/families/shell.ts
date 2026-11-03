import 'server-only';

import { resolveCurrentFamily } from './current';
import { countUnread, countUnreadByFamily } from '@/lib/notifications/service';
import { countUnreadMessages, countUnreadMessagesByFamily } from '@/lib/chat/service';
import type { FamilySummary } from './queries';

/**
 * Everything the app chrome needs, resolved once per page.
 *
 * Pages previously each fetched their own subset, which is how the chat badge
 * ended up never being passed at all — the sidebar accepted an
 * `unreadMessages` prop that no caller supplied. Centralising it means a badge
 * cannot silently go missing from one route.
 */
/**
 * A family in the switcher, with whatever is waiting in it.
 *
 * Carried for every family, not just the current one: an alert raised in a
 * family you are not looking at used to be invisible until you happened to
 * switch, and for an emergency that is the worst possible place to hide
 * something.
 */
export interface FamilyWithUnread extends FamilySummary {
  unreadAlerts: number;
  unreadMessages: number;
}

export interface ShellData {
  family: FamilySummary | null;
  families: FamilyWithUnread[];
  alertCount: number;
  unreadMessages: number;
}

export async function resolveShellData(userId: string): Promise<ShellData> {
  const { current, families } = await resolveCurrentFamily(userId);

  if (!current) {
    return { family: null, families: withNothingUnread(families), alertCount: 0, unreadMessages: 0 };
  }

  /*
   * Two grouped queries cover every family at once, so adding the badges did
   * not turn one page render into two queries per family.
   */
  const [alertCount, unreadMessages, alertsByFamily, messagesByFamily] = await Promise.all([
    countUnread(userId, current.id),
    countUnreadMessages(userId, current.id),
    countUnreadByFamily(userId),
    countUnreadMessagesByFamily(userId),
  ]);

  return {
    family: current,
    families: families.map((family) => ({
      ...family,
      unreadAlerts: alertsByFamily.get(family.id) ?? 0,
      unreadMessages: messagesByFamily.get(family.id) ?? 0,
    })),
    alertCount,
    unreadMessages,
  };
}

/** Shapes the list when there is no current family, so nothing is counted. */
function withNothingUnread(families: FamilySummary[]): FamilyWithUnread[] {
  return families.map((family) => ({ ...family, unreadAlerts: 0, unreadMessages: 0 }));
}

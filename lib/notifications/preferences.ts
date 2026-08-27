import 'server-only';

import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { notificationPreferences, type NotificationType } from '@/lib/db/schema';
import { requireMembership } from '@/lib/permissions/family';

/**
 * Notification preferences.
 *
 * Two rules that are not negotiable and are enforced here rather than in the
 * UI, so no future caller can route around them:
 *
 *  1. **SOS cannot be muted.** There is no preference for it, and
 *     `wantsNotification` returns true for it unconditionally. A family where
 *     somebody has silenced the emergency alert is not a safety net.
 *  2. **Quiet hours do not silence SOS either.** They suppress routine
 *     chatter — arrivals, chat, battery — and nothing else.
 *
 * An absent row means everything is on, so a member never misses an alert
 * because a preferences row was never created for them.
 */

export interface PreferencesView {
  arrivals: boolean;
  departures: boolean;
  sharingChanges: boolean;
  lowBattery: boolean;
  chatMessages: boolean;
  checkIns: boolean;
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
}

export const DEFAULT_PREFERENCES: PreferencesView = {
  arrivals: true,
  departures: true,
  sharingChanges: true,
  lowBattery: true,
  chatMessages: true,
  checkIns: true,
  quietHoursStart: null,
  quietHoursEnd: null,
};

export async function getPreferences(
  userId: string,
  familyId: string,
): Promise<PreferencesView> {
  const [row] = await db
    .select()
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.userId, userId),
        eq(notificationPreferences.familyId, familyId),
      ),
    )
    .limit(1);

  if (!row) return DEFAULT_PREFERENCES;

  return {
    arrivals: row.arrivals,
    departures: row.departures,
    sharingChanges: row.sharingChanges,
    lowBattery: row.lowBattery,
    chatMessages: row.chatMessages,
    checkIns: row.checkIns,
    quietHoursStart: row.quietHoursStart,
    quietHoursEnd: row.quietHoursEnd,
  };
}

export async function updatePreferences(
  userId: string,
  familyId: string,
  changes: Partial<PreferencesView>,
): Promise<PreferencesView> {
  await requireMembership(userId, familyId);

  const current = await getPreferences(userId, familyId);
  const next = { ...current, ...changes };

  await db
    .insert(notificationPreferences)
    .values({ userId, familyId, ...next, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [notificationPreferences.userId, notificationPreferences.familyId],
      set: { ...next, updatedAt: new Date() },
    });

  return next;
}

/* -------------------------------------------------------------------------- */
/* Filtering                                                                   */
/* -------------------------------------------------------------------------- */

/** Maps a notification type to the preference that governs it, if any. */
const GOVERNED_BY: Partial<Record<NotificationType, keyof PreferencesView>> = {
  ARRIVED_PLACE: 'arrivals',
  LEFT_PLACE: 'departures',
  LOCATION_ENABLED: 'sharingChanges',
  LOCATION_DISABLED: 'sharingChanges',
  // SOS and FAMILY_INVITE are deliberately absent — neither is optional.
};

/**
 * Whether a member wants a given notification right now.
 *
 * @param minutesPastMidnight the recipient's local time, for quiet hours.
 */
export function wantsNotification(
  type: NotificationType,
  preferences: PreferencesView,
  minutesPastMidnight?: number,
): boolean {
  // An emergency always gets through, whatever anyone has configured.
  if (type === 'SOS') return true;

  const key = GOVERNED_BY[type];
  if (key && preferences[key] === false) return false;

  if (minutesPastMidnight !== undefined && inQuietHours(preferences, minutesPastMidnight)) {
    return false;
  }

  return true;
}

/**
 * Quiet hours, handling the overnight case.
 *
 * A window of 22:00–07:00 wraps past midnight, so a plain `start <= t < end`
 * comparison would match nothing. Both orderings are handled explicitly.
 */
export function inQuietHours(
  preferences: Pick<PreferencesView, 'quietHoursStart' | 'quietHoursEnd'>,
  minutesPastMidnight: number,
): boolean {
  const { quietHoursStart: start, quietHoursEnd: end } = preferences;

  if (start === null || end === null) return false;
  if (start === end) return false;

  return start < end
    ? minutesPastMidnight >= start && minutesPastMidnight < end
    : minutesPastMidnight >= start || minutesPastMidnight < end;
}

/**
 * Filters a recipient list down to those who want this notification.
 *
 * Quiet hours are not applied here: the server does not know each recipient's
 * timezone, and guessing would silence alerts at the wrong times. They are
 * applied client-side when deciding whether to raise a browser notification,
 * where local time is actually known.
 */
export async function filterRecipients(
  familyId: string,
  recipientIds: string[],
  type: NotificationType,
): Promise<string[]> {
  if (type === 'SOS' || recipientIds.length === 0) return recipientIds;

  const key = GOVERNED_BY[type];
  if (!key) return recipientIds;

  const rows = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.familyId, familyId));

  const byUser = new Map(rows.map((r) => [r.userId, r]));

  return recipientIds.filter((id) => {
    const row = byUser.get(id);
    // No row means defaults, which are all on.
    if (!row) return true;
    return row[key as keyof typeof row] !== false;
  });
}

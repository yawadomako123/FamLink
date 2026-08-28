import 'server-only';

import { and, desc, eq, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  familyMembers,
  notifications,
  pushSubscriptions,
  users,
  type Notification,
  type NotificationType,
} from '@/lib/db/schema';
import { sendPushNotification } from '@/lib/firebase/server';
import { requireMembership } from '@/lib/permissions/family';
import { Errors } from '@/lib/api/errors';
import { publishEvent } from '@/lib/realtime/publish';
import { filterRecipients } from './preferences';

/**
 * Notifications.
 *
 * One row per recipient rather than one row fanned out at read time. That
 * costs a little storage and buys three things worth more: read state is
 * per-person, a member who joins later does not retroactively see old alerts,
 * and removing somebody from a family stops their notifications by cascade
 * rather than by remembering to filter.
 *
 * Payloads never contain coordinates. "Sarah arrived at School" is what the
 * family needs; a position would bypass the location visibility rule, since
 * notifications are not filtered through it.
 */

export interface NotificationView {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  data: Record<string, unknown> | null;
  readAt: Date | null;
  createdAt: Date;
}

/* -------------------------------------------------------------------------- */
/* Writing                                                                     */
/* -------------------------------------------------------------------------- */

export interface NotifyInput {
  familyId: string;
  type: NotificationType;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  /** Recipients. Defaults to every member except `exclude`. */
  recipientIds?: string[];
  /** Usually the person who caused the event — they don't need telling. */
  exclude?: string;
  /**
   * Groups push notifications that replace one another in the tray. Chat uses
   * it so a busy thread leaves one entry rather than twenty.
   */
  pushTag?: string;
  /**
   * Record the notification but do not push it to these members. Chat uses it
   * for people already reading the thread, who do not need their own phone
   * buzzing at them.
   */
  skipPushFor?: string[];
}

/**
 * Creates notifications and publishes a realtime hint.
 *
 * Never throws into the caller's path: an alert failing to send must not roll
 * back the arrival, message or SOS that triggered it.
 */
export async function notifyFamily(input: NotifyInput): Promise<void> {
  try {
    let recipients = input.recipientIds;

    if (!recipients) {
      const rows = await db
        .select({ userId: familyMembers.userId })
        .from(familyMembers)
        .where(
          input.exclude
            ? and(
                eq(familyMembers.familyId, input.familyId),
                ne(familyMembers.userId, input.exclude),
              )
            : eq(familyMembers.familyId, input.familyId),
        );

      recipients = rows.map((r) => r.userId);
    }

    /*
     * Respect each member's preferences — except for SOS, which
     * filterRecipients passes through untouched by design.
     */
    recipients = await filterRecipients(input.familyId, recipients, input.type);

    if (recipients.length === 0) return;

    await db.insert(notifications).values(
      recipients.map((userId) => ({
        userId,
        familyId: input.familyId,
        type: input.type,
        title: input.title,
        message: input.message,
        data: input.data ?? null,
      })),
    );

    await publishEvent(input.familyId, 'notification');

    /*
     * The in-app notification is recorded for everyone; the push is not.
     * Somebody with the thread open in front of them has already been told.
     */
    const skip = new Set(input.skipPushFor ?? []);
    const pushTo = recipients.filter((id) => !skip.has(id));

    if (pushTo.length > 0) {
      const subs = await db
        .select({ token: pushSubscriptions.token })
        .from(pushSubscriptions)
        .where(inArray(pushSubscriptions.userId, pushTo));

      // Push notifications are fired in the background
      Promise.allSettled(
        subs.map((sub) =>
          sendPushNotification(
            sub.token,
            input.title,
            input.message,
            input.data ? (input.data as Record<string, string>) : undefined,
            input.pushTag,
          ),
        ),
      ).catch((err) => console.error('[notifications] FCM push failed', err));
    }
  } catch (error) {
    console.error('[notifications] delivery failed', error);
  }
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                     */
/* -------------------------------------------------------------------------- */

export async function listNotifications(
  userId: string,
  familyId: string,
  limit = 50,
): Promise<NotificationView[]> {
  await requireMembership(userId, familyId);

  return db
    .select({
      id: notifications.id,
      type: notifications.type,
      title: notifications.title,
      message: notifications.message,
      data: notifications.data,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    // Scoped to the caller: there is no parameter for whose notifications to
    // read, so another member's cannot be requested.
    .where(and(eq(notifications.userId, userId), eq(notifications.familyId, familyId)))
    .orderBy(desc(notifications.createdAt))
    .limit(Math.min(limit, 100));
}

/**
 * Unread count for one family.
 *
 * Needs no membership check: the query is scoped to rows whose `user_id` is
 * the caller, and a non-member has none — so an unauthorized family id
 * returns 0 rather than disclosing anything.
 */
export async function countUnread(userId: string, familyId: string): Promise<number> {
  return db.$count(
    notifications,
    and(
      eq(notifications.userId, userId),
      eq(notifications.familyId, familyId),
      isNull(notifications.readAt),
    ),
  );
}

/** Unread counts across every family the user belongs to, in one query. */
export async function countUnreadAllFamilies(userId: string): Promise<number> {
  return db.$count(
    notifications,
    and(eq(notifications.userId, userId), isNull(notifications.readAt)),
  );
}

export async function markRead(
  userId: string,
  familyId: string,
  notificationIds?: string[],
): Promise<number> {
  await requireMembership(userId, familyId);

  const scope = and(
    // The userId predicate is what makes this safe: a caller supplying
    // somebody else's notification ids updates zero rows.
    eq(notifications.userId, userId),
    eq(notifications.familyId, familyId),
    isNull(notifications.readAt),
    ...(notificationIds && notificationIds.length > 0
      ? [inArray(notifications.id, notificationIds)]
      : []),
  );

  const updated = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(scope)
    .returning({ id: notifications.id });

  return updated.length;
}

/**
 * Housekeeping: drop read notifications older than the retention window.
 *
 * Not wired to a scheduler in the MVP — it exists so the growth path is
 * obvious and the query is already written and tested.
 */
export async function pruneOldNotifications(olderThanDays = 90): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);

  const deleted = await db
    .delete(notifications)
    .where(and(lt(notifications.createdAt, cutoff), sql`${notifications.readAt} is not null`))
    .returning({ id: notifications.id });

  return deleted.length;
}

/* -------------------------------------------------------------------------- */
/* Convenience builders                                                        */
/* -------------------------------------------------------------------------- */

/** INTERNAL: fan-out helper. Callers reach it only from guarded paths. */
export async function notifyPlaceEvent(
  familyId: string,
  actorId: string,
  actorName: string,
  placeName: string,
  type: 'arrived' | 'left',
  placeId: string,
): Promise<void> {
  await notifyFamily({
    familyId,
    type: type === 'arrived' ? 'ARRIVED_PLACE' : 'LEFT_PLACE',
    title: type === 'arrived' ? `${actorName} arrived` : `${actorName} left`,
    message:
      type === 'arrived'
        ? `${actorName} arrived at ${placeName}.`
        : `${actorName} left ${placeName}.`,
    // A place id, not a position.
    data: { placeId, actorId },
    exclude: actorId,
  });
}

/** INTERNAL: fan-out helper. Callers reach it only from guarded paths. */
export async function notifySharingChanged(
  familyId: string,
  actorId: string,
  actorName: string,
  enabled: boolean,
): Promise<void> {
  await notifyFamily({
    familyId,
    type: enabled ? 'LOCATION_ENABLED' : 'LOCATION_DISABLED',
    title: enabled ? `${actorName} is sharing location` : `${actorName} stopped sharing`,
    message: enabled
      ? `${actorName} turned on location sharing with this family.`
      : `${actorName} turned off location sharing with this family.`,
    data: { actorId },
    exclude: actorId,
  });
}

/**
 * Low-battery warning.
 *
 * A phone about to die is the most common reason a family member goes quiet,
 * so this is worth telling people about before the map simply stops updating.
 * Rate-limited by `battery_alerted_at` on the membership row — see
 * lib/location/service.ts.
 */
export async function notifyLowBattery(
  familyId: string,
  actorId: string,
  actorName: string,
  percentage: number,
): Promise<void> {
  await notifyFamily({
    familyId,
    type: 'LOCATION_DISABLED',
    title: `${actorName}'s phone is low`,
    message: `${actorName} is on ${percentage}% battery. Their location may stop updating soon.`,
    data: { actorId, percentage, lowBattery: true },
    exclude: actorId,
  });
}

/** Fetches a display name once, for use in notification copy. */
export async function displayName(userId: string): Promise<string> {
  const [row] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!row) throw Errors.notFound('That user');
  return row.name;
}

export type { Notification };

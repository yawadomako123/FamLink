import 'server-only';

import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { emergencyEvents, users, type EmergencyEvent } from '@/lib/db/schema';
import { requireMembership } from '@/lib/permissions/family';
import { Errors } from '@/lib/api/errors';
import { notifyFamily, displayName } from './service';
import { publishEvent } from '@/lib/realtime/publish';

/**
 * SOS / emergency events.
 *
 * Scope is deliberately, explicitly limited: **an SOS alerts the members of
 * this family and nobody else.** FamLink does not contact police, ambulance or
 * any emergency service, and no code path here should ever suggest it does.
 * The UI copy says the same thing before the button is pressed.
 *
 * One rule shapes the rest of this module: an SOS must send even when things
 * are going wrong. Location is optional, geofencing is skipped, and a failure
 * to notify never prevents the event being recorded.
 */

export interface EmergencyView {
  id: string;
  userId: string;
  memberName: string;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  status: 'active' | 'resolved' | 'cancelled';
  createdAt: Date;
  resolvedAt: Date | null;
}

export interface TriggerSosInput {
  familyId: string;
  /**
   * Optional on purpose. If the device cannot produce a fix in time, the alert
   * still goes out — "Sarah needs help, location unavailable" is far better
   * than no alert at all.
   */
  latitude?: number | undefined;
  longitude?: number | undefined;
  accuracy?: number | undefined;
}

export async function triggerSos(
  userId: string,
  input: TriggerSosInput,
): Promise<EmergencyEvent> {
  await requireMembership(userId, input.familyId);

  const [event] = await db
    .insert(emergencyEvents)
    .values({
      familyId: input.familyId,
      userId,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      accuracy: input.accuracy ?? null,
      status: 'active',
    })
    .returning();

  if (!event) throw Errors.internal();

  const name = await displayName(userId);
  const hasLocation = input.latitude != null && input.longitude != null;

  await notifyFamily({
    familyId: input.familyId,
    type: 'SOS',
    title: `🚨 ${name} needs help`,
    message: hasLocation
      ? `${name} triggered an SOS. Their location is on the map.`
      : `${name} triggered an SOS. Their location was not available.`,
    /*
     * The emergency id, not coordinates. Members fetch the event through the
     * authorized endpoint, which is also what keeps the alert list free of
     * position data.
     */
    data: { emergencyId: event.id, actorId: userId, hasLocation },
    // The sender is notified too: seeing the alert arrive is the confirmation
    // that it actually went out.
  });

  await publishEvent(input.familyId, 'emergency', { actorName: name });

  return event;
}

/**
 * Marks an SOS resolved.
 *
 * Any family member can resolve, not just the sender — somebody in trouble may
 * be in no position to clear their own alert, and a stuck "active" emergency
 * that only they can dismiss would be worse than useless.
 */
export async function resolveSos(
  userId: string,
  familyId: string,
  emergencyId: string,
): Promise<EmergencyEvent> {
  await requireMembership(userId, familyId);

  const [updated] = await db
    .update(emergencyEvents)
    .set({ status: 'resolved', resolvedAt: new Date(), resolvedBy: userId })
    .where(
      and(
        eq(emergencyEvents.id, emergencyId),
        // Scoped by family so an id from another family cannot be resolved.
        eq(emergencyEvents.familyId, familyId),
        eq(emergencyEvents.status, 'active'),
      ),
    )
    .returning();

  if (!updated) throw Errors.notFound('That alert');

  const name = await displayName(userId);

  await notifyFamily({
    familyId,
    type: 'SOS',
    title: 'Emergency resolved',
    message: `${name} marked the emergency alert as resolved.`,
    data: { emergencyId, resolved: true },
    exclude: userId,
  });

  await publishEvent(familyId, 'emergency');

  return updated;
}

/** Only the person who raised an alert may cancel it as a false alarm. */
export async function cancelSos(
  userId: string,
  familyId: string,
  emergencyId: string,
): Promise<void> {
  await requireMembership(userId, familyId);

  const [updated] = await db
    .update(emergencyEvents)
    .set({ status: 'cancelled', resolvedAt: new Date(), resolvedBy: userId })
    .where(
      and(
        eq(emergencyEvents.id, emergencyId),
        eq(emergencyEvents.familyId, familyId),
        // Only the sender can declare a false alarm.
        eq(emergencyEvents.userId, userId),
        eq(emergencyEvents.status, 'active'),
      ),
    )
    .returning();

  if (!updated) throw Errors.notFound('That alert');

  const name = await displayName(userId);

  await notifyFamily({
    familyId,
    type: 'SOS',
    title: 'False alarm',
    message: `${name} cancelled their SOS alert.`,
    data: { emergencyId, cancelled: true },
    exclude: userId,
  });

  await publishEvent(familyId, 'emergency');
}

/**
 * Active emergencies for a family.
 *
 * Coordinates are returned regardless of the sender's normal location
 * visibility. That is intentional and narrow: raising an SOS is an explicit,
 * deliberate act of asking this family for help, which is a stronger and more
 * specific consent than the standing sharing preference it overrides. It
 * applies only to `active` alerts, only to the coordinates captured at that
 * moment, and never to the sender's ongoing position.
 */
export async function listActiveEmergencies(
  userId: string,
  familyId: string,
): Promise<EmergencyView[]> {
  await requireMembership(userId, familyId);

  return db
    .select({
      id: emergencyEvents.id,
      userId: emergencyEvents.userId,
      memberName: users.name,
      latitude: emergencyEvents.latitude,
      longitude: emergencyEvents.longitude,
      accuracy: emergencyEvents.accuracy,
      status: emergencyEvents.status,
      createdAt: emergencyEvents.createdAt,
      resolvedAt: emergencyEvents.resolvedAt,
    })
    .from(emergencyEvents)
    .innerJoin(users, eq(users.id, emergencyEvents.userId))
    .where(
      and(eq(emergencyEvents.familyId, familyId), eq(emergencyEvents.status, 'active')),
    )
    .orderBy(desc(emergencyEvents.createdAt));
}

/** Recent emergencies, active or not, for the alerts history. */
export async function listEmergencyHistory(
  userId: string,
  familyId: string,
  limit = 20,
): Promise<EmergencyView[]> {
  await requireMembership(userId, familyId);

  return db
    .select({
      id: emergencyEvents.id,
      userId: emergencyEvents.userId,
      memberName: users.name,
      latitude: emergencyEvents.latitude,
      longitude: emergencyEvents.longitude,
      accuracy: emergencyEvents.accuracy,
      status: emergencyEvents.status,
      createdAt: emergencyEvents.createdAt,
      resolvedAt: emergencyEvents.resolvedAt,
    })
    .from(emergencyEvents)
    .innerJoin(users, eq(users.id, emergencyEvents.userId))
    .where(eq(emergencyEvents.familyId, familyId))
    .orderBy(desc(emergencyEvents.createdAt))
    .limit(Math.min(limit, 50));
}

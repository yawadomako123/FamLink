import 'server-only';

import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  memberPlaceStates,
  placeEvents,
  places,
  users,
  type Place,
} from '@/lib/db/schema';
import { requireMembership, requireRole } from '@/lib/permissions/family';
import { Errors } from '@/lib/api/errors';
import { evaluateGeofences, type GeofencePlace } from './geofence';
import type { CreatePlaceInput, UpdatePlaceInput } from '@/lib/validation/places';

/**
 * Places and geofence evaluation.
 *
 * Places belong to the family, not to the person who created them, so every
 * member sees the same Home and School. Creating one is open to any member;
 * editing and deleting are restricted to the creator or an admin, so a child
 * cannot quietly move "School" somewhere else.
 */

const MAX_PLACES_PER_FAMILY = 50;

/* -------------------------------------------------------------------------- */
/* CRUD                                                                        */
/* -------------------------------------------------------------------------- */

export async function listPlaces(callerId: string, familyId: string): Promise<Place[]> {
  await requireMembership(callerId, familyId);

  return db
    .select()
    .from(places)
    .where(eq(places.familyId, familyId))
    .orderBy(asc(places.name));
}

export async function createPlace(
  callerId: string,
  familyId: string,
  input: CreatePlaceInput,
): Promise<Place> {
  await requireMembership(callerId, familyId);

  const existing = await db.$count(places, eq(places.familyId, familyId));
  if (existing >= MAX_PLACES_PER_FAMILY) {
    throw Errors.conflict(
      `This family already has ${MAX_PLACES_PER_FAMILY} places. Delete one before adding another.`,
    );
  }

  const [place] = await db
    .insert(places)
    .values({
      familyId,
      createdBy: callerId,
      name: input.name,
      address: input.address ?? null,
      latitude: input.latitude,
      longitude: input.longitude,
      radius: input.radius,
      icon: input.icon,
    })
    .returning();

  if (!place) throw Errors.internal();
  return place;
}

/** Editing is limited to the place's creator or a family admin. */
async function requirePlaceControl(
  callerId: string,
  familyId: string,
  placeId: string,
): Promise<Place> {
  const membership = await requireMembership(callerId, familyId);

  const [place] = await db
    .select()
    .from(places)
    // Scoped by family as well as id, so a place id from another family
    // cannot be reached by guessing.
    .where(and(eq(places.id, placeId), eq(places.familyId, familyId)))
    .limit(1);

  if (!place) throw Errors.notFound('That place');

  const isAdmin = membership.role === 'owner' || membership.role === 'admin';
  if (place.createdBy !== callerId && !isAdmin) {
    throw Errors.forbidden('Only the person who added this place, or an admin, can change it.');
  }

  return place;
}

export async function updatePlace(
  callerId: string,
  familyId: string,
  placeId: string,
  input: UpdatePlaceInput,
): Promise<Place> {
  await requirePlaceControl(callerId, familyId, placeId);

  const [updated] = await db
    .update(places)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.address !== undefined ? { address: input.address } : {}),
      ...(input.latitude !== undefined ? { latitude: input.latitude } : {}),
      ...(input.longitude !== undefined ? { longitude: input.longitude } : {}),
      ...(input.radius !== undefined ? { radius: input.radius } : {}),
      ...(input.icon !== undefined ? { icon: input.icon } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(places.id, placeId), eq(places.familyId, familyId)))
    .returning();

  if (!updated) throw Errors.notFound('That place');

  /*
   * Moving or resizing a place invalidates everyone's inside/outside state:
   * judged against the new geometry, a member could be "inside" somewhere they
   * were last recorded as outside, which would fire a false arrival. Clearing
   * the state means the next fix re-establishes a baseline silently.
   */
  if (input.latitude !== undefined || input.longitude !== undefined || input.radius !== undefined) {
    await db.delete(memberPlaceStates).where(eq(memberPlaceStates.placeId, placeId));
  }

  return updated;
}

export async function deletePlace(
  callerId: string,
  familyId: string,
  placeId: string,
): Promise<void> {
  await requirePlaceControl(callerId, familyId, placeId);

  // Cascades clear member_place_states and place_events.
  await db.delete(places).where(and(eq(places.id, placeId), eq(places.familyId, familyId)));
}

/** Renaming a family's places wholesale is an admin action; kept for settings. */
export async function deleteAllPlaces(callerId: string, familyId: string): Promise<void> {
  await requireRole(callerId, familyId, 'admin');
  await db.delete(places).where(eq(places.familyId, familyId));
}

/* -------------------------------------------------------------------------- */
/* Geofence evaluation                                                         */
/* -------------------------------------------------------------------------- */

export interface DetectedTransition {
  placeId: string;
  placeName: string;
  type: 'arrived' | 'left';
  occurredAt: Date;
}

/**
 * Evaluates a member's new position against their family's places.
 *
 * INTERNAL: no membership check of its own. Its sole caller is
 * `recordLocation`, which has already proved membership *and* that sharing is
 * switched on before any position reaches this function.
 *
 * Called from the location write path. Because a PWA only reports while it is
 * open, this is the honest limit of FamLink's geofencing: transitions are
 * detected when an update arrives, not continuously. The README says so
 * plainly, and the UI never implies otherwise.
 */
export async function evaluateAndRecordGeofences(
  userId: string,
  familyId: string,
  position: { latitude: number; longitude: number; accuracy?: number | null },
  occurredAt: Date,
): Promise<DetectedTransition[]> {
  const familyPlaces = await db
    .select({
      id: places.id,
      name: places.name,
      latitude: places.latitude,
      longitude: places.longitude,
      radius: places.radius,
    })
    .from(places)
    .where(eq(places.familyId, familyId));

  if (familyPlaces.length === 0) return [];

  const priorStates = await db
    .select({
      placeId: memberPlaceStates.placeId,
      isInside: memberPlaceStates.isInside,
    })
    .from(memberPlaceStates)
    .where(
      and(
        eq(memberPlaceStates.userId, userId),
        inArray(
          memberPlaceStates.placeId,
          familyPlaces.map((p) => p.id),
        ),
      ),
    );

  const { transitions, states } = evaluateGeofences(
    position,
    familyPlaces as GeofencePlace[],
    priorStates,
  );

  if (states.length === 0) return [];

  const nameById = new Map(familyPlaces.map((p) => [p.id, p.name]));

  await db.transaction(async (tx) => {
    for (const state of states) {
      await tx
        .insert(memberPlaceStates)
        .values({
          userId,
          placeId: state.placeId,
          familyId,
          isInside: state.isInside,
          since: occurredAt,
          updatedAt: occurredAt,
        })
        .onConflictDoUpdate({
          target: [memberPlaceStates.userId, memberPlaceStates.placeId],
          set: { isInside: state.isInside, updatedAt: occurredAt },
        });
    }

    if (transitions.length > 0) {
      await tx.insert(placeEvents).values(
        transitions.map((t) => ({
          familyId,
          userId,
          placeId: t.placeId,
          type: t.type,
          occurredAt,
        })),
      );
    }
  });

  return transitions.map((t) => ({
    placeId: t.placeId,
    placeName: nameById.get(t.placeId) ?? 'a place',
    type: t.type,
    occurredAt,
  }));
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export interface PlaceEventView {
  id: string;
  type: 'arrived' | 'left';
  occurredAt: Date;
  placeName: string;
  memberName: string;
  memberId: string;
}

/** Recent arrivals and departures for the family. */
export async function listPlaceEvents(
  callerId: string,
  familyId: string,
  limit = 50,
): Promise<PlaceEventView[]> {
  await requireMembership(callerId, familyId);

  return db
    .select({
      id: placeEvents.id,
      type: placeEvents.type,
      occurredAt: placeEvents.occurredAt,
      placeName: places.name,
      memberName: users.name,
      memberId: placeEvents.userId,
    })
    .from(placeEvents)
    .innerJoin(places, eq(places.id, placeEvents.placeId))
    .innerJoin(users, eq(users.id, placeEvents.userId))
    .where(eq(placeEvents.familyId, familyId))
    .orderBy(desc(placeEvents.occurredAt))
    .limit(Math.min(limit, 100));
}

/**
 * Which place, if any, a set of members is currently at.
 *
 * Used to label the map and member list ("At school") instead of showing raw
 * coordinates. Reads recorded state rather than recomputing, so the label
 * always agrees with the events that were emitted.
 */
export async function getCurrentPlaces(
  callerId: string,
  familyId: string,
): Promise<Map<string, { placeId: string; placeName: string }>> {
  await requireMembership(callerId, familyId);

  const rows = await db
    .select({
      userId: memberPlaceStates.userId,
      placeId: memberPlaceStates.placeId,
      placeName: places.name,
    })
    .from(memberPlaceStates)
    .innerJoin(places, eq(places.id, memberPlaceStates.placeId))
    .where(
      and(eq(memberPlaceStates.familyId, familyId), eq(memberPlaceStates.isInside, true)),
    );

  const byUser = new Map<string, { placeId: string; placeName: string }>();
  // A member can be inside overlapping places; the first is good enough for a
  // label, and places are returned in a stable order.
  for (const row of rows) {
    if (!byUser.has(row.userId)) {
      byUser.set(row.userId, { placeId: row.placeId, placeName: row.placeName });
    }
  }

  return byUser;
}

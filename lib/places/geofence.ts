/**
 * Geofence transition detection.
 *
 * Pure and dependency-free so the rules can be tested exhaustively — this is
 * the logic most likely to produce wrong alerts, and a wrong alert about a
 * child arriving somewhere is worse than no alert.
 *
 * Two properties matter more than sophistication here:
 *
 *  1. **Only transitions produce events.** Being inside a radius is not an
 *     arrival; *becoming* inside is. Without prior state, every location ping
 *     inside a place would fire "arrived" again.
 *  2. **Uncertain fixes produce nothing.** When the reported accuracy is large
 *     relative to the radius, position cannot be resolved confidently enough
 *     to say whether a boundary was crossed, so no event is emitted and the
 *     previous state is preserved.
 */
import { distanceMetres, type Coordinates } from '@/lib/location/geo';

export interface GeofencePlace {
  id: string;
  latitude: number;
  longitude: number;
  radius: number;
}

export interface PriorState {
  placeId: string;
  isInside: boolean;
}

export type TransitionType = 'arrived' | 'left';

export interface Transition {
  placeId: string;
  type: TransitionType;
}

export interface EvaluationResult {
  /** Events to record and notify on. */
  transitions: Transition[];
  /** The state to persist for every place considered. */
  states: { placeId: string; isInside: boolean }[];
}

/**
 * Hysteresis: the exit boundary sits further out than the entry boundary.
 *
 * Without it, someone sitting exactly on the edge with jittering GPS would
 * emit arrived/left repeatedly — the classic geofence flapping problem, and
 * the fastest way to make a family mute FamLink's notifications.
 */
const EXIT_MARGIN = 1.25;

/**
 * A fix is too vague to judge when its accuracy radius exceeds this fraction
 * of the geofence radius. At 1.0 a 200m-accurate fix would be trusted to
 * resolve a 200m circle, which it plainly cannot.
 */
const MAX_ACCURACY_RATIO = 0.75;

export function evaluateGeofences(
  position: Coordinates & { accuracy?: number | null },
  places: GeofencePlace[],
  priorStates: PriorState[],
): EvaluationResult {
  const priorByPlace = new Map(priorStates.map((s) => [s.placeId, s.isInside]));

  const transitions: Transition[] = [];
  const states: { placeId: string; isInside: boolean }[] = [];

  for (const place of places) {
    const wasInside = priorByPlace.get(place.id);
    const distance = distanceMetres(position, place);

    // Too imprecise to tell which side of the boundary we are on: leave the
    // previous state untouched and say nothing.
    if (
      position.accuracy != null &&
      position.accuracy > place.radius * MAX_ACCURACY_RATIO
    ) {
      if (wasInside !== undefined) states.push({ placeId: place.id, isInside: wasInside });
      continue;
    }

    // Asymmetric thresholds — see EXIT_MARGIN.
    const isInside = wasInside
      ? distance <= place.radius * EXIT_MARGIN
      : distance <= place.radius;

    states.push({ placeId: place.id, isInside });

    // No prior state means this is the first fix we have judged for this
    // place. Record where they are, but do not announce an arrival for
    // somewhere they may have been all along.
    if (wasInside === undefined) continue;

    if (!wasInside && isInside) transitions.push({ placeId: place.id, type: 'arrived' });
    if (wasInside && !isInside) transitions.push({ placeId: place.id, type: 'left' });
  }

  return { transitions, states };
}

/** "Sarah arrived at School" / "Dad left Work". */
export function describeTransition(
  memberName: string,
  placeName: string,
  type: TransitionType,
): string {
  return type === 'arrived'
    ? `${memberName} arrived at ${placeName}`
    : `${memberName} left ${placeName}`;
}

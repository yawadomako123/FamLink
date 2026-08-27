/**
 * Geospatial helpers.
 *
 * Pure and dependency-free, so the throttling and geofence rules can be tested
 * directly. Shared by the browser (deciding whether to send an update) and the
 * server (deciding whether a fix crossed a place boundary).
 */

const EARTH_RADIUS_M = 6_371_008.8;

export interface Coordinates {
  latitude: number;
  longitude: number;
}

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/**
 * Great-circle distance in metres.
 *
 * Haversine rather than a planar approximation: FamLink's geofence radii go
 * down to ~50m, where the error from treating degrees as a flat grid is large
 * enough to produce spurious arrival events at higher latitudes.
 */
export function distanceMetres(a: Coordinates, b: Coordinates): number {
  const φ1 = toRadians(a.latitude);
  const φ2 = toRadians(b.latitude);
  const Δφ = toRadians(b.latitude - a.latitude);
  const Δλ = toRadians(b.longitude - a.longitude);

  const sinΔφ = Math.sin(Δφ / 2);
  const sinΔλ = Math.sin(Δλ / 2);

  const h = sinΔφ * sinΔφ + Math.cos(φ1) * Math.cos(φ2) * sinΔλ * sinΔλ;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function isWithinRadius(
  point: Coordinates,
  centre: Coordinates,
  radiusMetres: number,
): boolean {
  return distanceMetres(point, centre) <= radiusMetres;
}

/* -------------------------------------------------------------------------- */
/* Update throttling                                                           */
/* -------------------------------------------------------------------------- */

/**
 * A device sitting still still produces a stream of GPS fixes. Writing every
 * one would fill the history table with noise and burn battery for nothing, so
 * an update is sent only when the position has meaningfully changed or enough
 * time has passed to prove the member is still present.
 */
export const THROTTLE = {
  /** Movement below this is treated as GPS jitter, not travel. */
  minDistanceMetres: 75,
  /** Never send more often than this, however fast someone is moving. */
  minIntervalMs: 15_000,
  /** Send at least this often while stationary, as a liveness heartbeat. */
  maxIntervalMs: 4 * 60 * 1000,
  /** Fixes vaguer than this are not worth recording. */
  maxAccuracyMetres: 2_000,
} as const;

export interface ThrottleState {
  lastSentAt: number | null;
  lastPosition: Coordinates | null;
}

export type ThrottleDecision =
  | { send: true; reason: 'first-fix' | 'moved' | 'heartbeat' }
  | { send: false; reason: 'too-soon' | 'too-close' | 'too-inaccurate' };

/**
 * Decides whether a freshly observed position is worth sending.
 *
 * Kept pure so the policy is testable without a browser or a clock.
 */
export function shouldSendUpdate(
  position: Coordinates & { accuracy?: number | undefined },
  state: ThrottleState,
  now: number,
): ThrottleDecision {
  // A wildly imprecise fix would place someone streets away from where they
  // are; better to send nothing than to send that.
  if (position.accuracy !== undefined && position.accuracy > THROTTLE.maxAccuracyMetres) {
    return { send: false, reason: 'too-inaccurate' };
  }

  if (state.lastSentAt === null || state.lastPosition === null) {
    return { send: true, reason: 'first-fix' };
  }

  const elapsed = now - state.lastSentAt;

  // Hard floor, so a jittery GPS cannot trigger a burst of writes.
  if (elapsed < THROTTLE.minIntervalMs) {
    return { send: false, reason: 'too-soon' };
  }

  if (distanceMetres(position, state.lastPosition) >= THROTTLE.minDistanceMetres) {
    return { send: true, reason: 'moved' };
  }

  // Stationary, but silence is ambiguous: without a heartbeat the map could not
  // distinguish "still at home" from "app closed an hour ago".
  if (elapsed >= THROTTLE.maxIntervalMs) {
    return { send: true, reason: 'heartbeat' };
  }

  return { send: false, reason: 'too-close' };
}

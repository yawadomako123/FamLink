import { distanceMetres, type Coordinates } from './geo';

/**
 * Location quality filtering.
 *
 * What this can and cannot do is worth stating plainly, because "make location
 * accurate" has a hardware floor. Consumer GNSS is roughly 3–10m outdoors with
 * a clear sky, 20–50m under tree cover or between buildings, and often 100m+
 * indoors where the fix comes from Wi-Fi triangulation rather than satellites.
 * Nothing in software beats that.
 *
 * What software *can* fix is the noise on top of it:
 *
 *  - **Wild outliers.** A single bad fix can place someone a suburb away. A
 *    speed plausibility check rejects those.
 *  - **Accuracy regression.** GNSS often reports a coarse Wi-Fi fix first and
 *    refines it seconds later. Naively taking the newest means showing the
 *    worst.
 *  - **Jitter.** A stationary phone wanders by tens of metres. Accuracy-
 *    weighted smoothing settles it without adding lag when genuinely moving.
 *
 * All of it is pure, so the rules are directly testable.
 */

export interface Fix extends Coordinates {
  accuracy: number | null;
  /** Epoch milliseconds. */
  timestamp: number;
}

/**
 * Fastest speed treated as physically plausible, in metres per second.
 *
 * 90 m/s is about 324 km/h — above any car or train a family is realistically
 * on, but below a passenger jet, so it does not reject a genuine flight.
 * Anything faster is a bad fix, not a fast journey.
 */
export const MAX_PLAUSIBLE_SPEED_MS = 90;

/** Below this, a jump is never rejected: GPS jitter alone can produce it. */
const MIN_JUMP_TO_JUDGE_M = 100;

export type RejectionReason =
  | 'implausible-speed'
  | 'much-worse-accuracy'
  | 'stale'
  | 'unusable-accuracy';

export type FixVerdict =
  | { accept: true; reason: 'first' | 'better' | 'moved' | 'refresh' }
  | { accept: false; reason: RejectionReason };

/** A fix vaguer than this is not worth recording at all. */
export const UNUSABLE_ACCURACY_M = 2_000;

/**
 * Decides whether a newly observed fix should replace the current best.
 *
 * Modelled on the "best location estimate" logic Android's own docs recommend:
 * prefer significantly newer, prefer more accurate, and distrust a fix that is
 * both older and worse.
 */
export function judgeFix(candidate: Fix, current: Fix | null): FixVerdict {
  if (candidate.accuracy !== null && candidate.accuracy > UNUSABLE_ACCURACY_M) {
    return { accept: false, reason: 'unusable-accuracy' };
  }

  if (!current) return { accept: true, reason: 'first' };

  const elapsedMs = candidate.timestamp - current.timestamp;

  // An out-of-order fix is not evidence of anything newer.
  if (elapsedMs < 0) return { accept: false, reason: 'stale' };

  const moved = distanceMetres(candidate, current);

  /*
   * Speed check. Only applied to jumps large enough that jitter cannot explain
   * them, and only when we have a meaningful time base — two fixes in the same
   * millisecond would divide by ~zero and reject everything.
   */
  if (moved > MIN_JUMP_TO_JUDGE_M && elapsedMs > 1_000) {
    const speed = moved / (elapsedMs / 1000);
    if (speed > MAX_PLAUSIBLE_SPEED_MS) {
      return { accept: false, reason: 'implausible-speed' };
    }
  }

  const candidateAccuracy = candidate.accuracy ?? Number.POSITIVE_INFINITY;
  const currentAccuracy = current.accuracy ?? Number.POSITIVE_INFINITY;

  // Clearly better: take it regardless of age.
  if (candidateAccuracy < currentAccuracy) return { accept: true, reason: 'better' };

  /*
   * Meaningfully worse *and* recent enough that the old fix is still valid —
   * this is the coarse-then-refined pattern in reverse, and taking it would
   * visibly degrade the position for no reason.
   */
  if (candidateAccuracy > currentAccuracy * 2 && elapsedMs < 30_000) {
    return { accept: false, reason: 'much-worse-accuracy' };
  }

  // Genuine movement beyond the combined uncertainty of both fixes.
  if (moved > Math.max(candidateAccuracy, currentAccuracy)) {
    return { accept: true, reason: 'moved' };
  }

  // Same place, comparable quality, but new enough to be worth refreshing.
  return elapsedMs > 20_000
    ? { accept: true, reason: 'refresh' }
    : { accept: false, reason: 'much-worse-accuracy' };
}

/* -------------------------------------------------------------------------- */
/* Smoothing                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Accuracy-weighted blend of a new fix with the previous position.
 *
 * A precise fix pulls the result almost entirely to itself; a vague one barely
 * moves it. That damps the wander of a stationary phone without adding the lag
 * a fixed-alpha filter would introduce when somebody is actually travelling.
 *
 * Smoothing is skipped when the device has clearly moved, so the position does
 * not lag behind a real journey.
 */
export function smooth(candidate: Fix, previous: Fix | null): Fix {
  if (!previous) return candidate;

  const candidateAccuracy = candidate.accuracy ?? 50;
  const previousAccuracy = previous.accuracy ?? 50;

  const moved = distanceMetres(candidate, previous);

  // Genuine travel: trust the new fix as-is.
  if (moved > Math.max(candidateAccuracy, previousAccuracy) * 1.5) return candidate;

  // Weight by inverse variance — the standard way to combine two estimates.
  const candidateWeight = 1 / (candidateAccuracy * candidateAccuracy);
  const previousWeight = 1 / (previousAccuracy * previousAccuracy);
  const total = candidateWeight + previousWeight;

  return {
    latitude: (candidate.latitude * candidateWeight + previous.latitude * previousWeight) / total,
    longitude:
      (candidate.longitude * candidateWeight + previous.longitude * previousWeight) / total,
    // Combining two independent estimates yields a better one than either.
    accuracy: Math.sqrt(1 / total),
    timestamp: candidate.timestamp,
  };
}

/* -------------------------------------------------------------------------- */
/* Acquisition                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * How long to keep sampling when first acquiring a position.
 *
 * The first fix a browser returns is very often a coarse network-based one;
 * waiting a few seconds usually yields a satellite fix an order of magnitude
 * better. Bounded so switching sharing on never feels stuck.
 */
export const ACQUISITION_WINDOW_MS = 8_000;

/** Good enough to stop sampling early. */
export const ACQUISITION_TARGET_ACCURACY_M = 20;

/** Picks the most accurate of a set of samples, breaking ties by recency. */
export function bestOf(fixes: Fix[]): Fix | null {
  if (fixes.length === 0) return null;

  return fixes.reduce((best, fix) => {
    const bestAccuracy = best.accuracy ?? Number.POSITIVE_INFINITY;
    const accuracy = fix.accuracy ?? Number.POSITIVE_INFINITY;

    if (accuracy < bestAccuracy) return fix;
    if (accuracy === bestAccuracy && fix.timestamp > best.timestamp) return fix;
    return best;
  });
}

/** Plain-language quality label, used to set expectations in the UI. */
export function describeAccuracy(accuracy: number | null): {
  label: string;
  quality: 'precise' | 'good' | 'approximate' | 'poor' | 'unknown';
} {
  if (accuracy === null) return { label: 'Accuracy unknown', quality: 'unknown' };
  if (accuracy <= 15) return { label: `Precise to ~${Math.round(accuracy)}m`, quality: 'precise' };
  if (accuracy <= 50) return { label: `Accurate to ~${Math.round(accuracy)}m`, quality: 'good' };
  if (accuracy <= 200) {
    return { label: `Approximate — within ~${Math.round(accuracy)}m`, quality: 'approximate' };
  }
  return { label: `Rough — within ~${Math.round(accuracy)}m`, quality: 'poor' };
}

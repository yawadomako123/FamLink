import { describe, expect, it } from 'vitest';
import { judgeFix, smooth, type Fix } from '@/lib/location/accuracy';
import { shouldSendUpdate, THROTTLE, type ThrottleState } from '@/lib/location/geo';
import { evaluateGeofences, type GeofencePlace } from '@/lib/places/geofence';

/**
 * A journey, end to end through the real pipeline.
 *
 * Every piece of this is unit tested on its own — filtering, smoothing,
 * throttling, geofencing. None of it was tested *together*, and the behaviour
 * that matters to a family is emergent: a phone on a windowsill must not
 * appear to wander, a real walk must not be smoothed into standing still, and
 * one absurd fix must not teleport somebody across the city.
 *
 * This drives a synthetic trace through the same four functions the browser
 * calls, in the same order, with the jitter and accuracy variation a real
 * device produces. It is not a substitute for walking around with a phone —
 * nothing here proves the browser hands us what we assume — but it is the
 * difference between four functions that each work and a pipeline that does.
 */

const ACCRA = { latitude: 5.6037, longitude: -0.187 };

/** Metres to degrees, near the equator. Good enough for a test trace. */
const mLat = (m: number) => m / 111_320;
const mLng = (m: number, lat: number) => m / (111_320 * Math.cos((lat * Math.PI) / 180));

/**
 * Replays a trace exactly as `useLocation` does: judge, smooth, then decide
 * whether it is worth sending.
 */
function replay(trace: Fix[]) {
  let best: Fix | null = null;
  let throttle: ThrottleState = { lastSentAt: null, lastPosition: null };

  const sent: Fix[] = [];
  const rejected: string[] = [];

  for (const raw of trace) {
    const verdict = judgeFix(raw, best);
    if (!verdict.accept) {
      rejected.push(verdict.reason);
      continue;
    }

    const fix = smooth(raw, best);
    best = fix;

    const decision = shouldSendUpdate(
      { latitude: fix.latitude, longitude: fix.longitude, accuracy: fix.accuracy ?? undefined },
      throttle,
      fix.timestamp,
    );

    if (decision.send) {
      sent.push(fix);
      throttle = {
        lastSentAt: fix.timestamp,
        lastPosition: { latitude: fix.latitude, longitude: fix.longitude },
      };
    }
  }

  return { sent, rejected, best };
}

/* -------------------------------------------------------------------------- */

describe('a phone sitting still', () => {
  /**
   * Ten minutes on a windowsill. Real GPS wanders several metres even when
   * nothing moves, and every one of those is a position the device genuinely
   * reports.
   */
  const stationary = (): Fix[] => {
    const out: Fix[] = [];
    const start = Date.UTC(2026, 10, 3, 9, 0, 0);
    const wobble = [0, 4, -3, 6, -5, 2, -4, 5, -2, 3, -6, 4];

    wobble.forEach((metres, i) => {
      out.push({
        latitude: ACCRA.latitude + mLat(metres),
        longitude: ACCRA.longitude + mLng(-metres, ACCRA.latitude),
        accuracy: 8 + (i % 3) * 4,
        timestamp: start + i * 50_000,
      });
    });

    return out;
  };

  it('does not look like it is moving', () => {
    const { sent } = replay(stationary());

    /*
     * One opening fix, then heartbeats only. Anything more means jitter is
     * reaching the family's map as travel.
     */
    expect(sent.length).toBeLessThanOrEqual(4);
    expect(sent.length).toBeGreaterThanOrEqual(1);
  });

  it('still proves it is alive', () => {
    const { sent } = replay(stationary());
    const gaps = sent.slice(1).map((f, i) => f.timestamp - sent[i]!.timestamp);

    // Silence is ambiguous: the map could not tell "still at home" from
    // "app closed an hour ago" without these.
    for (const gap of gaps) {
      expect(gap).toBeGreaterThanOrEqual(THROTTLE.maxIntervalMs);
    }
  });

  it('stays put, rather than drifting with the noise', () => {
    const { best } = replay(stationary());
    const drift = Math.abs((best!.latitude - ACCRA.latitude) * 111_320);

    // Smoothing should hold it near the truth, not chase the last sample.
    expect(drift).toBeLessThan(6);
  });
});

/* -------------------------------------------------------------------------- */

describe('somebody actually walking', () => {
  /** Twenty minutes north at roughly walking pace, with ordinary jitter. */
  const walk = (): Fix[] => {
    const out: Fix[] = [];
    const start = Date.UTC(2026, 10, 3, 9, 0, 0);

    for (let i = 0; i < 20; i += 1) {
      const travelled = i * 80; // ~1.3 m/s over 60s steps
      const jitter = (i % 4) - 1.5;

      out.push({
        latitude: ACCRA.latitude + mLat(travelled + jitter),
        longitude: ACCRA.longitude + mLng(jitter, ACCRA.latitude),
        accuracy: 10,
        timestamp: start + i * 60_000,
      });
    }

    return out;
  };

  it('is reported as movement, not smoothed away', () => {
    const { sent } = replay(walk());

    // Roughly every other step clears the 75m movement threshold.
    expect(sent.length).toBeGreaterThanOrEqual(8);
  });

  it('does not lag behind where they really are', () => {
    const trace = walk();
    const { best } = replay(trace);
    const truth = trace.at(-1)!;

    const lag = Math.abs((best!.latitude - truth.latitude) * 111_320);

    /*
     * Smoothing is skipped once a device has clearly moved, so the position
     * must not trail the walk — a family watching somebody come home should
     * not see them a minute behind.
     */
    expect(lag).toBeLessThan(25);
  });
});

/* -------------------------------------------------------------------------- */

describe('a fix that cannot be true', () => {
  it('does not teleport somebody across the country', () => {
    const start = Date.UTC(2026, 10, 3, 9, 0, 0);

    const trace: Fix[] = [
      { ...ACCRA, accuracy: 10, timestamp: start },
      // Kumasi, 200km away, thirty seconds later.
      { latitude: 6.6885, longitude: -1.6244, accuracy: 10, timestamp: start + 30_000 },
      { ...ACCRA, accuracy: 10, timestamp: start + 60_000 },
    ];

    const { rejected, best } = replay(trace);

    expect(rejected).toContain('implausible-speed');
    // Still in Accra, where they never stopped being.
    expect(Math.abs(best!.latitude - ACCRA.latitude)).toBeLessThan(0.01);
  });

  it('drops a fix too vague to mean anything', () => {
    const start = Date.UTC(2026, 10, 3, 9, 0, 0);

    const { rejected } = replay([
      { ...ACCRA, accuracy: 10, timestamp: start },
      { ...ACCRA, accuracy: 50_000, timestamp: start + 60_000 },
    ]);

    expect(rejected).toContain('unusable-accuracy');
  });

  it('ignores a reading that arrives out of order', () => {
    const start = Date.UTC(2026, 10, 3, 9, 0, 0);

    const { rejected } = replay([
      { ...ACCRA, accuracy: 10, timestamp: start + 60_000 },
      { ...ACCRA, accuracy: 10, timestamp: start },
    ]);

    expect(rejected).toContain('stale');
  });
});

/* -------------------------------------------------------------------------- */

describe('arriving somewhere, through the whole pipeline', () => {
  const school: GeofencePlace = {
    id: 'school',
    latitude: ACCRA.latitude + mLat(1_200),
    longitude: ACCRA.longitude,
    radius: 150,
  };

  /** A walk that ends inside the school's radius. */
  function walkToSchool(): Fix[] {
    const start = Date.UTC(2026, 10, 3, 9, 0, 0);
    const out: Fix[] = [];

    for (let i = 0; i <= 15; i += 1) {
      out.push({
        latitude: ACCRA.latitude + mLat(i * 90),
        longitude: ACCRA.longitude,
        accuracy: 12,
        timestamp: start + i * 60_000,
      });
    }

    return out;
  }

  it('reports exactly one arrival across the whole journey', () => {
    const { sent } = replay(walkToSchool());

    let prior: { placeId: string; isInside: boolean }[] = [];
    const transitions: string[] = [];

    for (const fix of sent) {
      const result = evaluateGeofences(
        { latitude: fix.latitude, longitude: fix.longitude, accuracy: fix.accuracy },
        [school],
        prior,
      );
      prior = result.states;
      transitions.push(...result.transitions.map((t) => t.type));
    }

    // Not one per position inside the radius — being inside is not arriving.
    expect(transitions).toEqual(['arrived']);
  });

  /*
   * The guard that matters when a fix is vague: at 200m accuracy against a
   * 150m radius, which side of the boundary somebody is on is unknowable, and
   * announcing either way would be a guess presented as fact.
   */
  it('says nothing when the fix is too vague to place them', () => {
    const atTheGate = {
      latitude: school.latitude,
      longitude: school.longitude,
      accuracy: 200,
    };

    const result = evaluateGeofences(atTheGate, [school], [{ placeId: 'school', isInside: false }]);

    expect(result.transitions).toEqual([]);

    /*
     * The previous answer is carried forward unchanged rather than dropped.
     * Returning nothing would be the other tempting choice and is worse: the
     * caller writes what it is given, so an empty result would leave the
     * member with no recorded state at all and the next decent fix would read
     * as a first sighting — silently losing a departure they had already made.
     */
    expect(result.states).toEqual([{ placeId: 'school', isInside: false }]);
  });

  it('forgets nothing when a vague fix lands before any state exists', () => {
    const vague = {
      latitude: school.latitude,
      longitude: school.longitude,
      accuracy: 200,
    };

    // No prior state, so there is nothing to preserve and nothing to invent.
    const result = evaluateGeofences(vague, [school], []);

    expect(result.transitions).toEqual([]);
    expect(result.states).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import {
  bestOf,
  describeAccuracy,
  judgeFix,
  smooth,
  MAX_PLAUSIBLE_SPEED_MS,
  UNUSABLE_ACCURACY_M,
  type Fix,
} from '@/lib/location/accuracy';
import { distanceMetres } from '@/lib/location/geo';

/**
 * Location quality filtering.
 *
 * The failure that matters here is a bad fix reaching the family's map — once
 * somebody has been shown standing a suburb away, the damage is done. These
 * tests pin the rejections rather than the acceptances.
 */

const ACCRA = { latitude: 5.6037, longitude: -0.187 };
const T0 = 1_700_000_000_000;

const fix = (over: Partial<Fix> = {}): Fix => ({
  ...ACCRA,
  accuracy: 10,
  timestamp: T0,
  ...over,
});

/** Offsets north by a number of metres (~111.32 km per degree of latitude). */
const north = (metres: number) => ACCRA.latitude + metres / 111_320;

describe('judgeFix', () => {
  it('accepts the first fix', () => {
    expect(judgeFix(fix(), null)).toEqual({ accept: true, reason: 'first' });
  });

  it('rejects a fix too vague to be worth recording', () => {
    const verdict = judgeFix(fix({ accuracy: UNUSABLE_ACCURACY_M + 1 }), null);
    expect(verdict).toEqual({ accept: false, reason: 'unusable-accuracy' });
  });

  describe('plausibility', () => {
    it('rejects a jump that would require impossible speed', () => {
      // 50km in 10 seconds is 5000 m/s. A GPS glitch, not a journey.
      const teleport = fix({
        latitude: north(50_000),
        timestamp: T0 + 10_000,
      });

      expect(judgeFix(teleport, fix())).toEqual({
        accept: false,
        reason: 'implausible-speed',
      });
    });

    it('accepts fast but possible travel', () => {
      // ~1km in 20s is 50 m/s (180 km/h) — a train, and entirely plausible.
      const travelling = fix({
        latitude: north(1_000),
        timestamp: T0 + 20_000,
        accuracy: 10,
      });

      expect(judgeFix(travelling, fix()).accept).toBe(true);
    });

    it('does not apply the speed check to small jumps', () => {
      // 40m in 100ms implies 400 m/s, but at that distance it is jitter, and
      // rejecting it would discard ordinary fixes.
      const jitter = fix({ latitude: north(40), timestamp: T0 + 100, accuracy: 5 });

      expect(judgeFix(jitter, fix({ accuracy: 5 })).accept).toBe(true);
    });

    it('sits the threshold above road speed and below flight speed', () => {
      // Guards the constant itself: a family in a car must never be filtered.
      expect(MAX_PLAUSIBLE_SPEED_MS).toBeGreaterThan(60); // 216 km/h
      expect(MAX_PLAUSIBLE_SPEED_MS).toBeLessThan(200); // below cruising jet
    });
  });

  describe('accuracy preference', () => {
    it('takes a more accurate fix even when barely newer', () => {
      const better = fix({ accuracy: 5, timestamp: T0 + 500 });
      expect(judgeFix(better, fix({ accuracy: 40 }))).toEqual({
        accept: true,
        reason: 'better',
      });
    });

    it('rejects a much worse fix while the current one is still fresh', () => {
      // Browsers often follow a good satellite fix with a coarse network one.
      const worse = fix({ accuracy: 500, timestamp: T0 + 2_000 });
      expect(judgeFix(worse, fix({ accuracy: 8 }))).toEqual({
        accept: false,
        reason: 'much-worse-accuracy',
      });
    });

    it('accepts a worse fix once the current one has aged', () => {
      const worse = fix({ accuracy: 500, timestamp: T0 + 60_000 });
      expect(judgeFix(worse, fix({ accuracy: 8 })).accept).toBe(true);
    });

    it('accepts movement beyond the combined uncertainty', () => {
      const moved = fix({ latitude: north(80), accuracy: 10, timestamp: T0 + 10_000 });
      expect(judgeFix(moved, fix({ accuracy: 10 }))).toEqual({
        accept: true,
        reason: 'moved',
      });
    });
  });

  it('rejects an out-of-order fix', () => {
    const older = fix({ timestamp: T0 - 5_000 });
    expect(judgeFix(older, fix())).toEqual({ accept: false, reason: 'stale' });
  });
});

describe('smooth', () => {
  it('returns the candidate unchanged when there is no history', () => {
    const f = fix();
    expect(smooth(f, null)).toBe(f);
  });

  it('pulls towards the more accurate of the two', () => {
    const vague = fix({ latitude: north(60), accuracy: 100 });
    const precise = fix({ accuracy: 5, timestamp: T0 + 1_000 });

    const result = smooth(precise, vague);

    // The precise fix should dominate almost entirely.
    expect(distanceMetres(result, precise)).toBeLessThan(2);
  });

  it('improves the reported accuracy by combining estimates', () => {
    const a = fix({ accuracy: 20 });
    const b = fix({ accuracy: 20, timestamp: T0 + 1_000 });

    const result = smooth(b, a);

    // Two independent 20m estimates combine to better than 20m.
    expect(result.accuracy).toBeLessThan(20);
    expect(result.accuracy).toBeGreaterThan(0);
  });

  it('does not smooth away genuine travel', () => {
    // Smoothing a real journey would make the map lag behind the person.
    const moved = fix({ latitude: north(500), accuracy: 10, timestamp: T0 + 30_000 });
    const result = smooth(moved, fix({ accuracy: 10 }));

    expect(result).toBe(moved);
  });

  it('damps jitter from a stationary device', () => {
    const previous = fix({ accuracy: 15 });
    const jittered = fix({ latitude: north(20), accuracy: 15, timestamp: T0 + 5_000 });

    const result = smooth(jittered, previous);

    // Lands between the two rather than jumping the full 20m.
    const movedBy = distanceMetres(result, previous);
    expect(movedBy).toBeGreaterThan(0);
    expect(movedBy).toBeLessThan(20);
  });
});

describe('bestOf', () => {
  it('returns null for no samples', () => {
    expect(bestOf([])).toBeNull();
  });

  it('picks the most accurate sample', () => {
    const best = bestOf([
      fix({ accuracy: 120 }),
      fix({ accuracy: 8 }),
      fix({ accuracy: 45 }),
    ]);

    expect(best?.accuracy).toBe(8);
  });

  it('breaks ties by recency', () => {
    const best = bestOf([
      fix({ accuracy: 10, timestamp: T0 }),
      fix({ accuracy: 10, timestamp: T0 + 5_000 }),
    ]);

    expect(best?.timestamp).toBe(T0 + 5_000);
  });

  it('treats a missing accuracy as worst', () => {
    const best = bestOf([fix({ accuracy: null }), fix({ accuracy: 300 })]);
    expect(best?.accuracy).toBe(300);
  });
});

describe('describeAccuracy', () => {
  it('does not claim precision it does not have', () => {
    expect(describeAccuracy(null).quality).toBe('unknown');
    expect(describeAccuracy(8).quality).toBe('precise');
    expect(describeAccuracy(40).quality).toBe('good');
    expect(describeAccuracy(150).quality).toBe('approximate');
    expect(describeAccuracy(900).quality).toBe('poor');
  });
});

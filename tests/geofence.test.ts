import { describe, expect, it } from 'vitest';
import { describeTransition, evaluateGeofences } from '@/lib/places/geofence';

/**
 * Geofence transitions.
 *
 * A wrong alert here is worse than no alert — "Sarah left School" when she did
 * not is alarming, and a stream of flapping notifications gets FamLink muted.
 * These tests pin the conservative behaviour that prevents both.
 */

const SCHOOL = {
  id: 'school',
  latitude: 5.6037,
  longitude: -0.187,
  radius: 200,
};

/** Offsets in metres, converted to a latitude delta (~111.32 km per degree). */
const north = (metres: number) => ({
  latitude: SCHOOL.latitude + metres / 111_320,
  longitude: SCHOOL.longitude,
});

describe('evaluateGeofences', () => {
  describe('first observation', () => {
    it('records state but announces nothing', () => {
      // Being somewhere is not arriving there. Without this, the first ping
      // after adding a place would claim everyone just arrived.
      const result = evaluateGeofences(north(0), [SCHOOL], []);

      expect(result.transitions).toEqual([]);
      expect(result.states).toEqual([{ placeId: 'school', isInside: true }]);
    });

    it('records being outside without announcing a departure', () => {
      const result = evaluateGeofences(north(1000), [SCHOOL], []);

      expect(result.transitions).toEqual([]);
      expect(result.states).toEqual([{ placeId: 'school', isInside: false }]);
    });
  });

  describe('transitions', () => {
    it('emits an arrival when crossing in', () => {
      const result = evaluateGeofences(north(50), [SCHOOL], [
        { placeId: 'school', isInside: false },
      ]);

      expect(result.transitions).toEqual([{ placeId: 'school', type: 'arrived' }]);
    });

    it('emits a departure when crossing out', () => {
      const result = evaluateGeofences(north(1000), [SCHOOL], [
        { placeId: 'school', isInside: true },
      ]);

      expect(result.transitions).toEqual([{ placeId: 'school', type: 'left' }]);
    });

    it('stays silent while remaining inside', () => {
      const result = evaluateGeofences(north(50), [SCHOOL], [
        { placeId: 'school', isInside: true },
      ]);

      expect(result.transitions).toEqual([]);
      expect(result.states).toEqual([{ placeId: 'school', isInside: true }]);
    });

    it('stays silent while remaining outside', () => {
      const result = evaluateGeofences(north(5000), [SCHOOL], [
        { placeId: 'school', isInside: false },
      ]);

      expect(result.transitions).toEqual([]);
    });
  });

  describe('hysteresis', () => {
    it('does not report leaving while inside the exit margin', () => {
      // 230m out of a 200m radius: past the edge, but within the margin that
      // absorbs GPS jitter for someone sitting near the boundary.
      const result = evaluateGeofences(north(230), [SCHOOL], [
        { placeId: 'school', isInside: true },
      ]);

      expect(result.transitions).toEqual([]);
      expect(result.states).toEqual([{ placeId: 'school', isInside: true }]);
    });

    it('reports leaving once clearly beyond the margin', () => {
      const result = evaluateGeofences(north(300), [SCHOOL], [
        { placeId: 'school', isInside: true },
      ]);

      expect(result.transitions).toEqual([{ placeId: 'school', type: 'left' }]);
    });

    it('requires the tighter entry threshold to report arriving', () => {
      // The same 230m that would not trigger an exit must not trigger an entry
      // either — otherwise the margin would create a band that is both.
      const result = evaluateGeofences(north(230), [SCHOOL], [
        { placeId: 'school', isInside: false },
      ]);

      expect(result.transitions).toEqual([]);
      expect(result.states).toEqual([{ placeId: 'school', isInside: false }]);
    });

    it('does not flap when a stationary device jitters across the edge', () => {
      // Simulates a phone at the boundary whose fixes wobble either side.
      let state = [{ placeId: 'school', isInside: true }];
      const emitted: string[] = [];

      for (const metres of [195, 205, 198, 210, 202, 190, 215]) {
        const result = evaluateGeofences(north(metres), [SCHOOL], state);
        emitted.push(...result.transitions.map((t) => t.type));
        state = result.states;
      }

      expect(emitted).toEqual([]);
    });
  });

  describe('accuracy gating', () => {
    it('says nothing when the fix is too vague to resolve the boundary', () => {
      // A 200m-accurate fix cannot determine which side of a 200m circle you
      // are on; claiming otherwise would be inventing precision.
      const result = evaluateGeofences(
        { ...north(0), accuracy: 200 },
        [SCHOOL],
        [{ placeId: 'school', isInside: false }],
      );

      expect(result.transitions).toEqual([]);
    });

    it('preserves the previous state rather than resetting it', () => {
      const result = evaluateGeofences(
        { ...north(5000), accuracy: 500 },
        [SCHOOL],
        [{ placeId: 'school', isInside: true }],
      );

      expect(result.states).toEqual([{ placeId: 'school', isInside: true }]);
    });

    it('accepts a fix precise enough for the radius', () => {
      const result = evaluateGeofences(
        { ...north(20), accuracy: 30 },
        [SCHOOL],
        [{ placeId: 'school', isInside: false }],
      );

      expect(result.transitions).toEqual([{ placeId: 'school', type: 'arrived' }]);
    });

    it('treats a missing accuracy as usable', () => {
      const result = evaluateGeofences(north(20), [SCHOOL], [
        { placeId: 'school', isInside: false },
      ]);

      expect(result.transitions).toHaveLength(1);
    });
  });

  describe('multiple places', () => {
    const HOME = { id: 'home', latitude: 5.65, longitude: -0.187, radius: 200 };

    it('evaluates each place independently', () => {
      const result = evaluateGeofences(north(0), [SCHOOL, HOME], [
        { placeId: 'school', isInside: false },
        { placeId: 'home', isInside: true },
      ]);

      expect(result.transitions).toContainEqual({ placeId: 'school', type: 'arrived' });
      expect(result.transitions).toContainEqual({ placeId: 'home', type: 'left' });
    });

    it('handles overlapping places without conflict', () => {
      const OVERLAP = { id: 'overlap', latitude: SCHOOL.latitude, longitude: SCHOOL.longitude, radius: 400 };

      const result = evaluateGeofences(north(0), [SCHOOL, OVERLAP], [
        { placeId: 'school', isInside: false },
        { placeId: 'overlap', isInside: false },
      ]);

      expect(result.transitions).toHaveLength(2);
      expect(result.transitions.every((t) => t.type === 'arrived')).toBe(true);
    });

    it('returns no state when the family has no places', () => {
      const result = evaluateGeofences(north(0), [], []);

      expect(result).toEqual({ transitions: [], states: [] });
    });
  });
});

describe('describeTransition', () => {
  it('reads as a sentence', () => {
    expect(describeTransition('Sarah', 'School', 'arrived')).toBe('Sarah arrived at School');
    expect(describeTransition('Dad', 'Work', 'left')).toBe('Dad left Work');
  });
});

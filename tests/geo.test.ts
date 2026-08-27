import { describe, expect, it } from 'vitest';
import {
  distanceMetres,
  isWithinRadius,
  shouldSendUpdate,
  THROTTLE,
} from '@/lib/location/geo';

const ACCRA = { latitude: 5.6037, longitude: -0.187 };

describe('distanceMetres', () => {
  it('is zero for the same point', () => {
    expect(distanceMetres(ACCRA, ACCRA)).toBe(0);
  });

  it('matches a known separation', () => {
    // Accra to Kumasi is roughly 200km.
    const kumasi = { latitude: 6.6885, longitude: -1.6244 };
    const km = distanceMetres(ACCRA, kumasi) / 1000;

    expect(km).toBeGreaterThan(195);
    expect(km).toBeLessThan(210);
  });

  it('is symmetric', () => {
    const other = { latitude: 5.61, longitude: -0.19 };
    expect(distanceMetres(ACCRA, other)).toBeCloseTo(distanceMetres(other, ACCRA), 6);
  });

  it('handles the antimeridian without exploding', () => {
    // Naive coordinate subtraction reports half the globe here; the great
    // circle distance is small.
    const west = { latitude: 0, longitude: 179.99 };
    const east = { latitude: 0, longitude: -179.99 };

    expect(distanceMetres(west, east)).toBeLessThan(3_000);
  });

  it('stays accurate at high latitude, where a planar approximation drifts', () => {
    // One degree of longitude at 70°N is about 38km, not 111km.
    const a = { latitude: 70, longitude: 0 };
    const b = { latitude: 70, longitude: 1 };
    const km = distanceMetres(a, b) / 1000;

    expect(km).toBeGreaterThan(36);
    expect(km).toBeLessThan(40);
  });
});

describe('isWithinRadius', () => {
  it('includes a point on the boundary', () => {
    const centre = ACCRA;
    // ~111m north.
    const north = { latitude: ACCRA.latitude + 0.001, longitude: ACCRA.longitude };

    expect(isWithinRadius(north, centre, 200)).toBe(true);
    expect(isWithinRadius(north, centre, 50)).toBe(false);
  });
});

describe('shouldSendUpdate', () => {
  const stationary = { lastSentAt: 1_000_000, lastPosition: ACCRA };

  it('always sends the first fix', () => {
    const decision = shouldSendUpdate(ACCRA, { lastSentAt: null, lastPosition: null }, 0);

    expect(decision).toEqual({ send: true, reason: 'first-fix' });
  });

  it('refuses a wildly inaccurate fix even as the first one', () => {
    // Better to send nothing than to place someone streets away.
    const decision = shouldSendUpdate(
      { ...ACCRA, accuracy: THROTTLE.maxAccuracyMetres + 1 },
      { lastSentAt: null, lastPosition: null },
      0,
    );

    expect(decision).toEqual({ send: false, reason: 'too-inaccurate' });
  });

  it('refuses anything inside the minimum interval, however far it moved', () => {
    const faraway = { latitude: 6.6885, longitude: -1.6244 };
    const decision = shouldSendUpdate(
      faraway,
      stationary,
      stationary.lastSentAt + THROTTLE.minIntervalMs - 1,
    );

    expect(decision).toEqual({ send: false, reason: 'too-soon' });
  });

  it('sends once the device has moved a meaningful distance', () => {
    // ~220m north, comfortably past the jitter threshold.
    const moved = { latitude: ACCRA.latitude + 0.002, longitude: ACCRA.longitude };
    const decision = shouldSendUpdate(
      moved,
      stationary,
      stationary.lastSentAt + THROTTLE.minIntervalMs + 1,
    );

    expect(decision).toEqual({ send: true, reason: 'moved' });
  });

  it('treats small drift as jitter rather than travel', () => {
    // ~11m: a stationary phone's GPS wanders this much indoors.
    const jitter = { latitude: ACCRA.latitude + 0.0001, longitude: ACCRA.longitude };
    const decision = shouldSendUpdate(
      jitter,
      stationary,
      stationary.lastSentAt + THROTTLE.minIntervalMs + 1,
    );

    expect(decision).toEqual({ send: false, reason: 'too-close' });
  });

  it('sends a heartbeat while stationary so silence is not ambiguous', () => {
    // Without this, the map could not distinguish "still at home" from
    // "closed the app an hour ago".
    const decision = shouldSendUpdate(
      ACCRA,
      stationary,
      stationary.lastSentAt + THROTTLE.maxIntervalMs + 1,
    );

    expect(decision).toEqual({ send: true, reason: 'heartbeat' });
  });

  it('accepts a fix exactly at the accuracy limit', () => {
    const decision = shouldSendUpdate(
      { ...ACCRA, accuracy: THROTTLE.maxAccuracyMetres },
      { lastSentAt: null, lastPosition: null },
      0,
    );

    expect(decision.send).toBe(true);
  });
});

describe('boundsOf', () => {
  it('returns null for an empty set', async () => {
    const { boundsOf } = await import('@/lib/location/map-style');
    // Null forces callers to decide what to show when nobody is sharing,
    // rather than silently centring on a meaningless default.
    expect(boundsOf([])).toBeNull();
  });

  it('contains every supplied point', async () => {
    const { boundsOf } = await import('@/lib/location/map-style');

    const bounds = boundsOf([
      { latitude: 5.6037, longitude: -0.187 },
      { latitude: 6.6885, longitude: -1.6244 },
      { latitude: 5.55, longitude: 0.1 },
    ]);

    expect(bounds).not.toBeNull();
    expect(bounds!.south).toBeCloseTo(5.55, 4);
    expect(bounds!.north).toBeCloseTo(6.6885, 4);
    expect(bounds!.west).toBeCloseTo(-1.6244, 4);
    expect(bounds!.east).toBeCloseTo(0.1, 4);
  });

  it('degenerates to a point for a single location', async () => {
    const { boundsOf } = await import('@/lib/location/map-style');
    const bounds = boundsOf([{ latitude: 5.6037, longitude: -0.187 }]);

    expect(bounds).toEqual({ west: -0.187, east: -0.187, south: 5.6037, north: 5.6037 });
  });
});

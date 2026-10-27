import { describe, expect, it } from 'vitest';
import {
  historyQuerySchema,
  locationUpdateSchema,
  updateSharingSchema,
} from '@/lib/validation/location';

/**
 * The boundary every position crosses.
 *
 * Coordinates arrive from a device FamLink does not control, and this schema is
 * the only thing between one and the family's map. It was the largest untested
 * module in the location path, which is the wrong place to be taking anything
 * on trust: a fix that gets past here is stored, rendered, and used to decide
 * whether somebody arrived somewhere.
 */

const FAMILY = '00000000-0000-4000-8000-000000000000';

const valid = {
  familyId: FAMILY,
  latitude: 5.6037,
  longitude: -0.187,
  accuracy: 12,
  recordedAt: new Date().toISOString(),
};

describe('coordinates', () => {
  it('accepts a well-formed fix', () => {
    const result = locationUpdateSchema.safeParse(valid);

    expect(result.success).toBe(true);
    expect(result.data?.latitude).toBe(5.6037);
    expect(result.data?.recordedAt).toBeInstanceOf(Date);
  });

  it('accepts the exact poles and antimeridian', () => {
    for (const [latitude, longitude] of [
      [90, 180],
      [-90, -180],
      [0, 0],
    ] as const) {
      expect(locationUpdateSchema.safeParse({ ...valid, latitude, longitude }).success).toBe(
        true,
      );
    }
  });

  it('refuses coordinates outside the globe', () => {
    for (const patch of [
      { latitude: 90.0001 },
      { latitude: -90.0001 },
      { longitude: 180.0001 },
      { longitude: -180.0001 },
    ]) {
      expect(locationUpdateSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
    }
  });

  /*
   * The specific failure this guards against: a latitude and longitude that are
   * each individually "0" by accident land in the Gulf of Guinea, and the
   * schema cannot tell that apart from a real fix. What it *can* reject is
   * anything that is not a finite number at all.
   */
  it('refuses values that are not finite numbers', () => {
    for (const bad of [NaN, Infinity, -Infinity, '5.6', null, undefined]) {
      expect(
        locationUpdateSchema.safeParse({ ...valid, latitude: bad }).success,
        `latitude ${String(bad)} must be refused`,
      ).toBe(false);
    }
  });

  it('requires a real family id', () => {
    expect(locationUpdateSchema.safeParse({ ...valid, familyId: 'not-a-uuid' }).success).toBe(
      false,
    );
    expect(locationUpdateSchema.safeParse({ ...valid, familyId: '' }).success).toBe(false);
  });
});

describe('accuracy', () => {
  it('is optional, because not every device reports it', () => {
    const { accuracy: _dropped, ...withoutAccuracy } = valid;

    expect(locationUpdateSchema.safeParse(withoutAccuracy).success).toBe(true);
  });

  it('refuses a negative radius', () => {
    expect(locationUpdateSchema.safeParse({ ...valid, accuracy: -1 }).success).toBe(false);
  });

  /* Past 100km it is not a location, and storing it would imply knowledge. */
  it('refuses a radius too vague to mean anything', () => {
    expect(locationUpdateSchema.safeParse({ ...valid, accuracy: 100_000 }).success).toBe(true);
    expect(locationUpdateSchema.safeParse({ ...valid, accuracy: 100_001 }).success).toBe(false);
  });
});

describe('when the reading was taken', () => {
  /*
   * The one that matters most. Freshness is computed from this timestamp, so a
   * future-dated fix would read as "Live" for as long as it stayed ahead of
   * the clock — a stale position wearing a current label, which is the single
   * thing this app is most careful never to do.
   */
  it('refuses a timestamp from the future', () => {
    const ahead = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    expect(locationUpdateSchema.safeParse({ ...valid, recordedAt: ahead }).success).toBe(false);
  });

  it('allows a little clock skew, because device clocks drift', () => {
    const slightlyAhead = new Date(Date.now() + 30 * 1000).toISOString();

    expect(
      locationUpdateSchema.safeParse({ ...valid, recordedAt: slightlyAhead }).success,
    ).toBe(true);
  });

  it('allows the recent past, so a client can flush what it buffered offline', () => {
    const anHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    expect(locationUpdateSchema.safeParse({ ...valid, recordedAt: anHourAgo }).success).toBe(
      true,
    );
  });

  it('refuses a reading older than a day', () => {
    const ancient = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();

    expect(locationUpdateSchema.safeParse({ ...valid, recordedAt: ancient }).success).toBe(
      false,
    );
  });

  it('refuses a timestamp it cannot read', () => {
    for (const bad of ['yesterday', '', 'not-a-date', NaN]) {
      expect(locationUpdateSchema.safeParse({ ...valid, recordedAt: bad }).success).toBe(false);
    }
  });

  it('takes epoch milliseconds as well as an ISO string', () => {
    const result = locationUpdateSchema.safeParse({ ...valid, recordedAt: Date.now() });

    expect(result.success).toBe(true);
    expect(result.data?.recordedAt).toBeInstanceOf(Date);
  });
});

describe('battery', () => {
  it('is optional — Safari and Firefox removed the API', () => {
    expect(locationUpdateSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts a whole percentage with a charging flag', () => {
    const result = locationUpdateSchema.safeParse({
      ...valid,
      battery: { percentage: 42, isCharging: true },
    });

    expect(result.success).toBe(true);
    expect(result.data?.battery?.percentage).toBe(42);
  });

  it('refuses a percentage outside 0–100, or a fractional one', () => {
    for (const percentage of [-1, 101, 42.5]) {
      expect(
        locationUpdateSchema.safeParse({ ...valid, battery: { percentage } }).success,
      ).toBe(false);
    }
  });
});

describe('sharing settings', () => {
  it('accepts either field, or both', () => {
    expect(updateSharingSchema.safeParse({ state: 'sharing' }).success).toBe(true);
    expect(updateSharingSchema.safeParse({ visibility: 'nobody' }).success).toBe(true);
    expect(
      updateSharingSchema.safeParse({ state: 'paused', visibility: 'everyone' }).success,
    ).toBe(true);
  });

  it('refuses a request that changes nothing', () => {
    expect(updateSharingSchema.safeParse({}).success).toBe(false);
  });

  it('refuses a sharing state the product does not have', () => {
    for (const state of ['on', 'enabled', 'SHARING', '']) {
      expect(updateSharingSchema.safeParse({ state }).success).toBe(false);
    }
  });

  /* `selected` is in the database enum but not yet writable through the API. */
  it('refuses a visibility the MVP does not write', () => {
    expect(updateSharingSchema.safeParse({ visibility: 'selected' }).success).toBe(false);
  });
});

describe('history queries', () => {
  it('defaults the timezone offset rather than failing without one', () => {
    const result = historyQuerySchema.safeParse({ familyId: FAMILY });

    expect(result.success).toBe(true);
    expect(result.data?.timezoneOffset).toBe(0);
  });

  it('accepts the real range of world offsets', () => {
    for (const timezoneOffset of [-840, -300, 0, 330, 840]) {
      expect(
        historyQuerySchema.safeParse({ familyId: FAMILY, timezoneOffset }).success,
      ).toBe(true);
    }
  });

  it('refuses an offset no timezone has', () => {
    for (const timezoneOffset of [-841, 841, 10_000]) {
      expect(
        historyQuerySchema.safeParse({ familyId: FAMILY, timezoneOffset }).success,
      ).toBe(false);
    }
  });

  it('insists a date is a plain calendar day', () => {
    expect(historyQuerySchema.safeParse({ familyId: FAMILY, date: '2026-10-27' }).success).toBe(
      true,
    );

    for (const date of ['27-10-2026', '2026-10-27T00:00:00Z', '2026-1-1', 'today']) {
      expect(historyQuerySchema.safeParse({ familyId: FAMILY, date }).success).toBe(false);
    }
  });
});

/* ========================================================================== */

/**
 * Timed sharing.
 *
 * The service has accepted `durationMinutes` and enforced the resulting expiry
 * since timed sharing was written — on write in `recordLocation`, and again on
 * read in `getFamilyLocations` so a lapsed window cannot keep showing a last
 * known position. The schema did not list the field, so every route stripped it
 * before the service saw one and the whole feature was unreachable.
 */
describe('timed sharing windows', () => {
  it('accepts a duration alongside switching sharing on', () => {
    const result = updateSharingSchema.safeParse({ state: 'sharing', durationMinutes: 60 });

    expect(result.success).toBe(true);
    expect(result.data?.durationMinutes).toBe(60);
  });

  it('accepts null, meaning share until switched off', () => {
    const result = updateSharingSchema.safeParse({ state: 'sharing', durationMinutes: null });

    expect(result.success).toBe(true);
    expect(result.data?.durationMinutes).toBeNull();
  });

  it('treats a duration on its own as a complete request', () => {
    expect(updateSharingSchema.safeParse({ durationMinutes: 30 }).success).toBe(true);
  });

  it('refuses a window that is not a whole number of minutes', () => {
    expect(updateSharingSchema.safeParse({ durationMinutes: 12.5 }).success).toBe(false);
  });

  it('refuses a window of zero or less', () => {
    for (const durationMinutes of [0, -1, -60]) {
      expect(updateSharingSchema.safeParse({ durationMinutes }).success).toBe(false);
    }
  });

  /*
   * A window long enough to forget is indistinguishable from sharing
   * indefinitely, which is already what leaving it unset does.
   */
  it('refuses a window longer than a day', () => {
    expect(updateSharingSchema.safeParse({ durationMinutes: 24 * 60 }).success).toBe(true);
    expect(updateSharingSchema.safeParse({ durationMinutes: 24 * 60 + 1 }).success).toBe(false);
  });

  /*
   * Switching off clears any window; asking for both in one request is a
   * contradiction, and the service would resolve it silently in favour of off.
   */
  it('refuses a window set while switching sharing off', () => {
    expect(
      updateSharingSchema.safeParse({ state: 'off', durationMinutes: 60 }).success,
    ).toBe(false);

    // Clearing the window while switching off is coherent, and allowed.
    expect(
      updateSharingSchema.safeParse({ state: 'off', durationMinutes: null }).success,
    ).toBe(true);
  });

  it('still refuses a request that changes nothing at all', () => {
    expect(updateSharingSchema.safeParse({}).success).toBe(false);
  });
});

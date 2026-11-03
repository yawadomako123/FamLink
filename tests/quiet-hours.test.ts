import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PREFERENCES,
  inQuietHours,
  wantsNotification,
  type PreferencesView,
} from '@/lib/notifications/preferences';

/**
 * Quiet hours.
 *
 * These exist because the feature shipped without them and did nothing for it.
 * `inQuietHours` and `wantsNotification` were written, exported and documented,
 * the settings screen saved a window, the API persisted it — and no code path
 * anywhere ever read it. Members set quiet hours, saw them stored, and were
 * still woken at 3am. A pure function with no caller and no test is
 * indistinguishable from a function that does not work.
 *
 * Two properties matter more than the arithmetic: an overnight window must
 * wrap, and an SOS must never be silenced by one.
 */

const prefs = (start: number | null, end: number | null): PreferencesView => ({
  ...DEFAULT_PREFERENCES,
  quietHoursStart: start,
  quietHoursEnd: end,
});

const at = (hours: number, minutes = 0) => hours * 60 + minutes;

describe('inQuietHours', () => {
  it('is never quiet when no window is set', () => {
    // The default for every member who has never opened the screen, and for
    // every family that predates the feature.
    expect(inQuietHours(prefs(null, null), at(3))).toBe(false);
  });

  it('is never quiet when only one end is set', () => {
    // A half-written window is not a window. Silencing from 22:00 to "never"
    // would mute a member permanently.
    expect(inQuietHours(prefs(at(22), null), at(23))).toBe(false);
    expect(inQuietHours(prefs(null, at(7)), at(3))).toBe(false);
  });

  it('treats a zero-length window as no window at all', () => {
    // 22:00-22:00 is the shape a slider lands on while being dragged. Read as
    // a wrap it would cover the entire day and silence everything.
    expect(inQuietHours(prefs(at(22), at(22)), at(22))).toBe(false);
    expect(inQuietHours(prefs(at(22), at(22)), at(3))).toBe(false);
  });

  describe('a daytime window', () => {
    const during = prefs(at(13), at(14, 30));

    it('covers the time inside it', () => {
      expect(inQuietHours(during, at(13, 30))).toBe(true);
    });

    it('starts the moment it says it does', () => {
      expect(inQuietHours(during, at(13))).toBe(true);
      expect(inQuietHours(during, at(12, 59))).toBe(false);
    });

    it('ends before the minute it says it ends', () => {
      // Exclusive, so a 13:00-14:30 window and a 14:30-15:00 window do not
      // both claim 14:30.
      expect(inQuietHours(during, at(14, 29))).toBe(true);
      expect(inQuietHours(during, at(14, 30))).toBe(false);
    });
  });

  describe('an overnight window', () => {
    // The case the whole function exists for: 22:00-07:00 wraps past midnight,
    // so a plain start <= t < end comparison matches nothing at all and the
    // feature silently does nothing on the exact schedule most people pick.
    const night = prefs(at(22), at(7));

    it('covers the late evening', () => {
      expect(inQuietHours(night, at(22))).toBe(true);
      expect(inQuietHours(night, at(23, 59))).toBe(true);
    });

    it('covers midnight itself', () => {
      expect(inQuietHours(night, at(0))).toBe(true);
    });

    it('covers the early morning', () => {
      expect(inQuietHours(night, at(3))).toBe(true);
      expect(inQuietHours(night, at(6, 59))).toBe(true);
    });

    it('releases at the end of the window', () => {
      expect(inQuietHours(night, at(7))).toBe(false);
    });

    it('leaves the day alone', () => {
      expect(inQuietHours(night, at(9))).toBe(false);
      expect(inQuietHours(night, at(21, 59))).toBe(false);
    });
  });
});

describe('wantsNotification', () => {
  it('lets an SOS through in the middle of quiet hours', () => {
    // The reason quiet hours are allowed to exist. If this ever returns false,
    // somebody's emergency is sitting silently on a sleeping phone.
    expect(wantsNotification('SOS', prefs(at(22), at(7)), at(3))).toBe(true);
  });

  it('lets an SOS through even when every preference is off', () => {
    const silenced: PreferencesView = {
      arrivals: false,
      departures: false,
      sharingChanges: false,
      lowBattery: false,
      chatMessages: false,
      checkIns: false,
      quietHoursStart: at(0),
      quietHoursEnd: at(23, 59),
    };

    expect(wantsNotification('SOS', silenced, at(12))).toBe(true);
  });

  it('suppresses routine chatter inside the window', () => {
    expect(wantsNotification('NEW_MESSAGE', prefs(at(22), at(7)), at(3))).toBe(false);
    expect(wantsNotification('ARRIVED_PLACE', prefs(at(22), at(7)), at(3))).toBe(false);
  });

  it('allows routine chatter outside the window', () => {
    expect(wantsNotification('NEW_MESSAGE', prefs(at(22), at(7)), at(12))).toBe(true);
  });

  it('ignores quiet hours when no local time is supplied', () => {
    // The server's own position: it does not know anybody's timezone, so it
    // must not guess. Omitting the argument has to mean "not my decision",
    // never "assume midnight".
    expect(wantsNotification('NEW_MESSAGE', prefs(at(22), at(7)))).toBe(true);
  });

  it('still honours a type switched off, whatever the time', () => {
    const off = { ...DEFAULT_PREFERENCES, arrivals: false };

    expect(wantsNotification('ARRIVED_PLACE', off, at(12))).toBe(false);
  });

  it('passes through a type no preference governs', () => {
    // FAMILY_INVITE has no switch, by design.
    expect(wantsNotification('FAMILY_INVITE', DEFAULT_PREFERENCES, at(12))).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */

/**
 * The service worker's copy of the same decision.
 *
 * It has to be a copy: quiet hours can only be judged where local time is
 * known, which is the device, and a service worker cannot import a TypeScript
 * module. So the same rule is written twice — and two copies of a wrapping
 * time comparison are exactly the kind of thing that drifts apart silently,
 * one of them handling midnight and the other not.
 *
 * This lifts the function out of the shipped worker and holds it against the
 * server's across every minute of the day. If somebody edits one, this fails.
 */
function loadWorkerInQuietHours(): (start: number, end: number) => boolean {
  const source = readFileSync('public/firebase-messaging-sw.js', 'utf8');

  const opening = 'const inQuietHours = (';
  const start = source.indexOf(opening);
  expect(start, 'inQuietHours is gone from the service worker').toBeGreaterThan(-1);

  const closing = '\n  };';
  const end = source.indexOf(closing, start);
  expect(end, 'could not find the end of the worker helper').toBeGreaterThan(-1);

  const body = source.slice(start, end + closing.length);
  const factory = new Function(`${body}\nreturn inQuietHours;`);

  return factory() as (start: number, end: number) => boolean;
}

describe('the service worker agrees with the server', () => {
  const workerInQuietHours = loadWorkerInQuietHours();

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // An overnight window, a daytime one, and one ending exactly at midnight —
  // the last being where an off-by-one in either copy would show up.
  const windows: [string, number, number][] = [
    ['22:00-07:00', at(22), at(7)],
    ['13:00-14:30', at(13), at(14, 30)],
    ['23:00-00:00', at(23), at(0)],
    ['00:00-06:00', at(0), at(6)],
  ];

  for (const [label, windowStart, windowEnd] of windows) {
    it(`matches for ${label} at every minute of the day`, () => {
      const disagreements: string[] = [];

      for (let minute = 0; minute < 24 * 60; minute += 1) {
        // Local time, which is what the worker reads via getHours/getMinutes.
        vi.setSystemTime(new Date(2026, 5, 1, Math.floor(minute / 60), minute % 60));

        const onDevice = workerInQuietHours(windowStart, windowEnd);
        const onServer = inQuietHours(prefs(windowStart, windowEnd), minute);

        if (onDevice !== onServer) {
          disagreements.push(
            `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')} ` +
              `(worker ${onDevice}, server ${onServer})`,
          );
        }
      }

      expect(disagreements, 'the two copies of quiet hours have drifted apart').toEqual([]);
    });
  }

  it('silences nothing when handed a window that is not a window', () => {
    /*
     * A push with no quiet-hours fields — every SOS, and every push to a
     * member who has set no window — parses to NaN. The handler's
     * `Number.isFinite` guard is what stops those reaching here, and this is
     * the second line of defence behind it: if that guard is ever dropped,
     * NaN must still mean "not quiet" rather than silencing an emergency.
     */
    vi.setSystemTime(new Date(2026, 5, 1, 3, 0));

    expect(workerInQuietHours(Number.NaN, Number.NaN)).toBe(false);
  });
});

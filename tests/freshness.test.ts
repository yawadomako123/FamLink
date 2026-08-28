import { describe, expect, it } from 'vitest';
import {
  callDuration,
  formatDuration,
  isStale,
  locationFreshness,
  timeAgo,
  STALE_AFTER_MS,
  VERY_STALE_AFTER_MS,
} from '@/lib/time';

/**
 * FamLink must never present an old location as a live one. These tests pin
 * that behaviour, because it is a product promise rather than a detail.
 */

const NOW = new Date('2026-08-27T12:00:00Z').getTime();
const ago = (ms: number) => new Date(NOW - ms);

describe('locationFreshness', () => {
  it('calls a very recent fix live', () => {
    expect(locationFreshness(ago(30_000), NOW)).toEqual({ label: 'Live', state: 'live' });
  });

  it('still calls a fix live at the edge of the staleness window', () => {
    expect(locationFreshness(ago(STALE_AFTER_MS), NOW).state).toBe('live');
  });

  it('stops claiming live one millisecond past the window', () => {
    const result = locationFreshness(ago(STALE_AFTER_MS + 1), NOW);
    expect(result.state).not.toBe('live');
    expect(result.label).toMatch(/^Last seen/);
  });

  it('marks an hour-old fix as stale rather than recent', () => {
    expect(locationFreshness(ago(VERY_STALE_AFTER_MS + 60_000), NOW).state).toBe('stale');
  });

  it('never implies a location exists when there is none', () => {
    expect(locationFreshness(null, NOW)).toEqual({ label: 'No location', state: 'unknown' });
    expect(locationFreshness(undefined, NOW)).toEqual({ label: 'No location', state: 'unknown' });
  });

  it('does not report a future timestamp as stale', () => {
    // Clock skew between a device and the server must not read as "last seen".
    expect(locationFreshness(new Date(NOW + 30_000), NOW).state).toBe('live');
  });
});

describe('isStale', () => {
  it('is false inside the window and true outside it', () => {
    expect(isStale(ago(STALE_AFTER_MS - 1), NOW)).toBe(false);
    expect(isStale(ago(STALE_AFTER_MS + 1), NOW)).toBe(true);
  });
});

describe('timeAgo', () => {
  it('describes recent moments plainly', () => {
    expect(timeAgo(ago(5_000), NOW)).toBe('just now');
    expect(timeAgo(ago(4 * 60_000), NOW)).toBe('4 min ago');
    expect(timeAgo(ago(2 * 3_600_000), NOW)).toBe('2 hr ago');
  });

  it('singularises a single day', () => {
    expect(timeAgo(ago(24 * 3_600_000), NOW)).toBe('1 day ago');
    expect(timeAgo(ago(3 * 24 * 3_600_000), NOW)).toBe('3 days ago');
  });

  it('treats a future timestamp as the present', () => {
    expect(timeAgo(new Date(NOW + 10_000), NOW)).toBe('just now');
  });
});

describe('formatDuration', () => {
  it('uses seconds below a minute', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(45_000)).toBe('45s');
    expect(formatDuration(59_400)).toBe('59s');
  });

  it('zero-pads seconds once minutes appear, the way a call log does', () => {
    expect(formatDuration(60_000)).toBe('1:00');
    expect(formatDuration(127_000)).toBe('2:07');
    expect(formatDuration(59 * 60_000 + 59_000)).toBe('59:59');
  });

  it('adds an hours field only when there are hours', () => {
    expect(formatDuration(3_600_000)).toBe('1:00:00');
    expect(formatDuration(4_470_000)).toBe('1:14:30');
  });

  it('never renders a negative length', () => {
    expect(formatDuration(-5_000)).toBe('0s');
  });
});

describe('callDuration', () => {
  const answered = new Date('2026-08-27T12:00:00Z');

  it('measures from the answer, not from the first ring', () => {
    expect(callDuration(answered, new Date('2026-08-27T12:02:07Z'))).toBe('2:07');
  });

  /*
   * The important case: a call nobody picked up is not a zero-second
   * conversation, and must not be presented as one.
   */
  it('reports no duration for a call that was never answered', () => {
    expect(callDuration(null, new Date('2026-08-27T12:00:40Z'))).toBeNull();
  });

  it('reports no duration for a call still in progress', () => {
    expect(callDuration(answered, null)).toBeNull();
  });

  it('refuses a negative span rather than rendering nonsense', () => {
    expect(callDuration(answered, new Date('2026-08-27T11:59:00Z'))).toBeNull();
  });

  it('accepts the ISO strings the client boundary hands it', () => {
    expect(callDuration('2026-08-27T12:00:00Z', '2026-08-27T12:00:30Z')).toBe('30s');
  });
});

import { describe, expect, it } from 'vitest';
import {
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

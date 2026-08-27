/**
 * Relative-time helpers.
 *
 * FamLink is careful never to present an old location as a live one, so these
 * helpers are shared by every surface that renders a timestamp.
 */

/** A location older than this is shown as "last seen", never as live. */
export const STALE_AFTER_MS = 5 * 60 * 1000;

/** Beyond this a location is old enough that we stop implying any currency. */
export const VERY_STALE_AFTER_MS = 60 * 60 * 1000;

export function isStale(at: Date | string | number, now: number = Date.now()): boolean {
  return now - new Date(at).getTime() > STALE_AFTER_MS;
}

/** "just now", "4 min ago", "2 hr ago", "3 days ago". */
export function timeAgo(at: Date | string | number, now: number = Date.now()): string {
  const ms = now - new Date(at).getTime();

  if (ms < 0) return 'just now';
  if (ms < 45_000) return 'just now';

  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;

  const days = Math.round(hours / 24);
  if (days < 30) return `${days} ${days === 1 ? 'day' : 'days'} ago`;

  const months = Math.round(days / 30);
  if (months < 12) return `${months} ${months === 1 ? 'month' : 'months'} ago`;

  const years = Math.round(months / 12);
  return `${years} ${years === 1 ? 'year' : 'years'} ago`;
}

/**
 * The phrase used next to a member's location. Deliberately distinguishes a
 * live fix from a remembered one — see the background-location limitation in
 * the README.
 */
export function locationFreshness(
  at: Date | string | number | null | undefined,
  now: number = Date.now(),
): { label: string; state: 'live' | 'recent' | 'stale' | 'unknown' } {
  if (!at) return { label: 'No location', state: 'unknown' };

  const ms = now - new Date(at).getTime();
  if (ms <= STALE_AFTER_MS) return { label: 'Live', state: 'live' };
  if (ms <= VERY_STALE_AFTER_MS) {
    return { label: `Last seen ${timeAgo(at, now)}`, state: 'recent' };
  }
  return { label: `Last seen ${timeAgo(at, now)}`, state: 'stale' };
}

/** "9:42 AM" in the viewer's locale. */
export function formatClock(at: Date | string | number): string {
  return new Date(at).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** "Today", "Yesterday", or "12 Mar 2026". */
export function formatDayLabel(at: Date | string | number, now: Date = new Date()): string {
  const d = new Date(at);
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

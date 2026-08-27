import { cn } from '@/lib/utils';

export type PresenceStatus = 'sharing' | 'paused' | 'offline' | 'stale';

const STYLES: Record<PresenceStatus, { dot: string; label: string }> = {
  sharing: { dot: 'bg-status-sharing', label: 'Sharing location' },
  paused: { dot: 'bg-status-paused', label: 'Location paused' },
  stale: { dot: 'bg-status-stale', label: 'Location out of date' },
  offline: { dot: 'bg-status-offline', label: 'Not sharing' },
};

/**
 * The status dot never claims more than we know. "sharing" means the member
 * has sharing switched on AND we have a recent fix; an old fix downgrades to
 * "stale" rather than staying green.
 */
export function StatusDot({
  status,
  className,
  withRing = false,
}: {
  status: PresenceStatus;
  className?: string;
  withRing?: boolean;
}) {
  const style = STYLES[status];
  return (
    <span
      role="img"
      aria-label={style.label}
      title={style.label}
      className={cn(
        'inline-block size-2.5 rounded-full shrink-0',
        style.dot,
        withRing && 'ring-2 ring-card',
        className,
      )}
    />
  );
}

export function statusLabel(status: PresenceStatus): string {
  return STYLES[status].label;
}

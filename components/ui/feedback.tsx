import * as React from 'react';
import { AlertTriangle, Info, CheckCircle2, WifiOff } from 'lucide-react';
import { cn } from '@/lib/utils';

/* -------------------------------------------------------------------------- */
/* Skeletons                                                                   */
/* -------------------------------------------------------------------------- */

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('skeleton rounded-lg', className)} />;
}

export function MemberRowSkeleton() {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <Skeleton className="size-10 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-3.5 w-28" />
        <Skeleton className="h-3 w-20" />
      </div>
      <Skeleton className="h-3 w-10" />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Alerts                                                                      */
/* -------------------------------------------------------------------------- */

type AlertTone = 'info' | 'warning' | 'error' | 'success';

const ALERT_TONES: Record<AlertTone, { wrap: string; icon: React.ElementType }> = {
  info: { wrap: 'bg-tint-brand text-on-tint-brand border-line-brand', icon: Info },
  success: { wrap: 'bg-tint-brand text-on-tint-brand border-line-brand', icon: CheckCircle2 },
  warning: { wrap: 'bg-tint-warn text-on-tint-warn border-line-warn', icon: AlertTriangle },
  error: { wrap: 'bg-tint-danger text-on-tint-danger border-line-danger', icon: AlertTriangle },
};

export function Alert({
  tone = 'info',
  title,
  children,
  className,
  action,
}: {
  tone?: AlertTone;
  title?: string;
  children?: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
}) {
  const { wrap, icon: Icon } = ALERT_TONES[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('flex gap-3 rounded-xl border px-4 py-3 text-sm', wrap, className)}
    >
      <Icon aria-hidden className="size-4.5 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn(title && 'mt-0.5', 'text-[13px] leading-relaxed')}>{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Empty states                                                                */
/* -------------------------------------------------------------------------- */

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: React.ElementType;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center text-center px-6 py-12', className)}>
      <div className="size-12 rounded-2xl bg-inset flex items-center justify-center mb-4">
        <Icon aria-hidden className="size-6 text-subtle" />
      </div>
      <p className="font-semibold text-fg">{title}</p>
      {description && <p className="text-sm text-muted mt-1 max-w-xs text-balance">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Connection banner                                                           */
/* -------------------------------------------------------------------------- */

/** Shown when the realtime stream drops. Honest about what is happening. */
export function ConnectionBanner({ state }: { state: 'reconnecting' | 'polling' | 'offline' }) {
  const copy = {
    reconnecting: 'Connection lost. Trying to reconnect…',
    polling: 'Live updates unavailable. Refreshing periodically.',
    offline: "You're offline. Showing the last data we received.",
  } as const;

  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 bg-tint-warn text-on-tint-warn text-xs font-medium px-4 py-2 border-b border-line-warn"
    >
      <WifiOff aria-hidden className="size-3.5" />
      {copy[state]}
    </div>
  );
}

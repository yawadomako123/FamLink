'use client';

import * as React from 'react';
import type { DailyCount } from '@/lib/admin/service';
import { cn } from '@/lib/utils';

/**
 * Thirty days of sign-ups, drawn as bars.
 *
 * Hand-drawn rather than pulled from a charting library: two series over thirty
 * points is not worth ~50kB of JavaScript on a page one person looks at, and a
 * chart built from divs inherits the app's theming and needs no client-side
 * measurement to lay out.
 *
 * The bars are `<div>`s and the data is also given as a table to screen
 * readers, because a wall of coloured rectangles conveys nothing without one.
 */
export function GrowthChart({ data }: { data: DailyCount[] }) {
  const [hovered, setHovered] = React.useState<number | null>(null);

  // A flat run of zeroes must not scale up into a full-height chart of nothing.
  const peak = Math.max(1, ...data.map((d) => Math.max(d.users, d.families)));
  const totals = data.reduce(
    (acc, d) => ({ users: acc.users + d.users, families: acc.families + d.families }),
    { users: 0, families: 0 },
  );

  const active = hovered !== null ? data[hovered] : null;

  return (
    <div className="px-5 pb-5">
      <div className="flex items-center gap-4 text-xs text-muted mb-3">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-sm bg-brand-600" />
          People ({totals.users})
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-sm bg-status-sharing" />
          Families ({totals.families})
        </span>

        <span className="ml-auto tabular-nums text-subtle">
          {active
            ? `${active.day}: ${active.users} people, ${active.families} families`
            : `${data.length} days`}
        </span>
      </div>

      <div
        aria-hidden
        className="flex items-end gap-px h-32"
        onMouseLeave={() => setHovered(null)}
      >
        {data.map((day, i) => (
          <div
            key={day.day}
            onMouseEnter={() => setHovered(i)}
            className={cn(
              'flex-1 min-w-0 h-full flex items-end justify-center gap-px rounded-sm transition-colors',
              hovered === i && 'bg-raised',
            )}
          >
            <Bar value={day.users} peak={peak} className="bg-brand-600" />
            <Bar value={day.families} peak={peak} className="bg-status-sharing" />
          </div>
        ))}
      </div>

      {/* The same numbers, for anyone the bars are useless to. */}
      <table className="sr-only">
        <caption>New people and families per day</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">People</th>
            <th scope="col">Families</th>
          </tr>
        </thead>
        <tbody>
          {data.map((day) => (
            <tr key={day.day}>
              <th scope="row">{day.day}</th>
              <td>{day.users}</td>
              <td>{day.families}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Bar({ value, peak, className }: { value: number; peak: number; className: string }) {
  // A day with nothing in it still gets a sliver, so the axis reads as a
  // timeline rather than as a gap where data went missing.
  const height = value === 0 ? 2 : Math.max(3, Math.round((value / peak) * 100));

  return (
    <div
      className={cn('w-full rounded-t-sm', value === 0 ? 'bg-line' : className)}
      style={{ height: `${height}%` }}
    />
  );
}

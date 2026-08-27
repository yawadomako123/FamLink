'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, ChevronsUpDown, Loader2, Plus } from 'lucide-react';
import { api, errorMessage } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import type { FamilySummary } from '@/lib/families/queries';

/**
 * Switches which family the app is showing.
 *
 * The data model has always supported belonging to several families — sharing
 * settings are per-membership precisely so somebody can share with their
 * household and not with their in-laws. Only the UI assumed one, which made
 * the second family unreachable once joined.
 *
 * Renders as plain text when there is only one, so the common case gains no
 * control it does not need.
 */
export function FamilySwitcher({
  current,
  families,
  className,
}: {
  current: FamilySummary;
  families: FamilySummary[];
  className?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [switchingTo, setSwitchingTo] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  async function switchTo(familyId: string) {
    if (familyId === current.id) {
      setOpen(false);
      return;
    }

    setSwitchingTo(familyId);
    setError(null);

    try {
      await api.post('/api/v1/families/current', { familyId });
      setOpen(false);
      // Every server-rendered surface is family-scoped, so refresh them all.
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSwitchingTo(null);
    }
  }

  // One family: no switcher, just the name.
  if (families.length <= 1) {
    return (
      <div className={className}>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-subtle">Family</p>
        <p className="text-sm font-medium text-fg truncate mt-0.5">{current.name}</p>
      </div>
    );
  }

  return (
    <div ref={ref} className={cn('relative', className)}>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-subtle">Family</p>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="mt-0.5 w-full flex items-center gap-1.5 text-left rounded-lg -mx-1 px-1 py-0.5 hover:bg-raised transition-colors"
      >
        <span className="flex-1 text-sm font-medium text-fg truncate">{current.name}</span>
        <ChevronsUpDown aria-hidden className="size-3.5 text-subtle shrink-0" />
      </button>

      {error && (
        <p role="alert" className="text-xs text-danger-600 mt-1">
          {error}
        </p>
      )}

      {open && (
        <div
          role="listbox"
          aria-label="Switch family"
          className="absolute left-0 right-0 top-full mt-1 z-30 bg-card border border-line rounded-xl shadow-lift p-1"
        >
          {families.map((family) => {
            const isCurrent = family.id === current.id;
            const isSwitching = switchingTo === family.id;

            return (
              <button
                key={family.id}
                type="button"
                role="option"
                aria-selected={isCurrent}
                disabled={switchingTo !== null}
                onClick={() => void switchTo(family.id)}
                className={cn(
                  'w-full flex items-center gap-2 px-2 py-2 rounded-lg text-left transition-colors',
                  isCurrent ? 'bg-tint-brand' : 'hover:bg-raised',
                  switchingTo !== null && !isSwitching && 'opacity-50',
                )}
              >
                <span className="flex-1 min-w-0">
                  <span
                    className={cn(
                      'block text-sm font-medium truncate',
                      isCurrent ? 'text-on-tint-brand' : 'text-fg',
                    )}
                  >
                    {family.name}
                  </span>
                  <span className="block text-xs text-muted">
                    {family.memberCount} {family.memberCount === 1 ? 'member' : 'members'} ·{' '}
                    {family.role}
                  </span>
                </span>

                {isSwitching ? (
                  <Loader2 aria-hidden className="size-4 animate-spin text-muted" />
                ) : (
                  isCurrent && <Check aria-hidden className="size-4 text-on-tint-brand" />
                )}
              </button>
            );
          })}

          <div className="border-t border-line mt-1 pt-1">
            <Link
              href="/family/new"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-2 py-2 rounded-lg text-sm text-muted hover:bg-raised hover:text-fg transition-colors"
            >
              <Plus aria-hidden className="size-4" />
              Create or join another
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

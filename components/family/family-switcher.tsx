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
/**
 * The switch itself, without any of the chrome around it.
 *
 * Shared because the same action is offered from three places now — the
 * desktop sidebar, the mobile header, and the family page — and a second copy
 * of "POST then refresh" is a second place for the refresh to be forgotten.
 */
export function useFamilySwitch() {
  const router = useRouter();
  const [switchingTo, setSwitchingTo] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const switchTo = React.useCallback(
    async (familyId: string) => {
      setSwitchingTo(familyId);
      setError(null);

      try {
        await api.post('/api/v1/families/current', { familyId });
        // Every server-rendered surface is family-scoped, so refresh them all.
        router.refresh();
        return true;
      } catch (err) {
        setError(errorMessage(err));
        return false;
      } finally {
        setSwitchingTo(null);
      }
    },
    [router],
  );

  return { switchTo, switchingTo, error, clearError: () => setError(null) };
}

export function FamilySwitcher({
  current,
  families,
  className,
  variant = 'sidebar',
}: {
  current: FamilySummary;
  families: FamilySummary[];
  className?: string;
  /**
   * `sidebar` stacks a label above the name and fills its column. `compact` is
   * a single chip for the mobile header, where there is no column to fill and
   * no room for a label.
   */
  variant?: 'sidebar' | 'compact';
}) {
  const [open, setOpen] = React.useState(false);
  const { switchTo, switchingTo, error } = useFamilySwitch();
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

  async function select(familyId: string) {
    if (familyId === current.id) {
      setOpen(false);
      return;
    }

    const done = await switchTo(familyId);
    if (done) setOpen(false);
  }

  const compact = variant === 'compact';

  /*
   * One family: nothing to switch between. The sidebar still wants the name
   * as a heading; the header does not want a dead chip taking up its width,
   * so it renders nothing at all.
   */
  if (families.length <= 1) {
    if (compact) return null;

    return (
      <div className={className}>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-subtle">Family</p>
        <p className="text-sm font-medium text-fg truncate mt-0.5">{current.name}</p>
      </div>
    );
  }

  return (
    <div ref={ref} className={cn('relative', compact && 'min-w-0', className)}>
      {!compact && (
        <p className="text-[11px] font-semibold uppercase tracking-wider text-subtle">Family</p>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Current family: ${current.name}. Switch family`}
        className={cn(
          'flex items-center text-left transition-colors',
          compact
            // Narrow, and narrower still on a small phone: this chip shares a
            // row with the page title and must yield to it.
            ? 'min-w-0 max-w-28 sm:max-w-40 gap-1 rounded-lg px-2 h-8 bg-raised hover:bg-inset'
            : 'mt-0.5 w-full gap-1.5 rounded-lg -mx-1 px-1 py-0.5 hover:bg-raised',
        )}
      >
        <span
          className={cn(
            'truncate text-sm font-medium text-fg',
            compact ? 'min-w-0' : 'flex-1',
          )}
        >
          {current.name}
        </span>
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
          className={cn(
            'absolute top-full mt-1 z-30 bg-card border border-line rounded-xl shadow-lift p-1',
            // The header chip is narrow; its menu should not be.
            compact ? 'left-0 w-60 max-w-[calc(100vw-2rem)]' : 'left-0 right-0',
          )}
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
                onClick={() => void select(family.id)}
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

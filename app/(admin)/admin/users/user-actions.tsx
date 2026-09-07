'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, LogOut, MoreVertical, ShieldCheck, ShieldOff } from 'lucide-react';
import { api, errorMessage } from '@/lib/api/client';
import { cn } from '@/lib/utils';

/**
 * The two things an operator can do to an account.
 *
 * Signing somebody out everywhere, which locks a lost phone without touching
 * anything they own; and granting or withdrawing admin.
 *
 * Deleting accounts is deliberately not here. A user is the hinge of families,
 * messages and emergencies, and the person best placed to press that button is
 * the one furthest from understanding what it would take with it.
 */
export function UserActions({
  userId,
  name,
  isPlatformAdmin,
  activeSessions,
  isSelf,
}: {
  userId: string;
  name: string;
  isPlatformAdmin: boolean;
  activeSessions: number;
  isSelf: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function run(action: () => Promise<unknown>, confirmation?: string) {
    if (confirmation && !window.confirm(confirmation)) return;

    setBusy(true);
    setError(null);

    try {
      await action();
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Manage ${name}`}
        className="size-8 rounded-lg flex items-center justify-center text-subtle hover:text-fg hover:bg-raised transition-colors"
      >
        {busy ? (
          <Loader2 aria-hidden className="size-4 animate-spin" />
        ) : (
          <MoreVertical aria-hidden className="size-4" />
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 w-64 bg-card border border-line rounded-xl shadow-lift overflow-hidden z-20 p-1"
        >
          <MenuItem
            icon={LogOut}
            disabled={activeSessions === 0}
            onSelect={() =>
              void run(
                () => api.post(`/api/v1/admin/users/${userId}/revoke-sessions`),
                `Sign ${name} out of every device? They will need to log in again.`,
              )
            }
          >
            {activeSessions === 0
              ? 'No sessions to end'
              : `Sign out everywhere (${activeSessions})`}
          </MenuItem>

          <MenuItem
            icon={isPlatformAdmin ? ShieldOff : ShieldCheck}
            danger={isPlatformAdmin}
            // Withdrawing your own is refused by the server too; disabling it
            // here just avoids offering a button that only ever errors.
            disabled={isSelf && isPlatformAdmin}
            onSelect={() =>
              void run(
                () =>
                  api.post(`/api/v1/admin/users/${userId}/platform-admin`, {
                    value: !isPlatformAdmin,
                  }),
                isPlatformAdmin
                  ? `Remove admin access from ${name}?`
                  : `Give ${name} full admin access to every account and family on the platform?`,
              )
            }
          >
            {isSelf && isPlatformAdmin
              ? 'You cannot remove your own access'
              : isPlatformAdmin
                ? 'Remove admin access'
                : 'Make platform admin'}
          </MenuItem>

          {error && (
            <p role="alert" className="px-2.5 py-2 text-xs text-danger-600">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon: Icon,
  onSelect,
  disabled,
  danger,
  children,
}: {
  icon: React.ElementType;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      disabled={disabled}
      className={cn(
        'w-full flex items-center gap-2.5 min-h-9 px-2.5 py-1.5 rounded-lg text-sm text-left transition-colors',
        'disabled:opacity-45 disabled:cursor-not-allowed',
        danger ? 'text-danger-600 hover:bg-tint-danger' : 'text-fg hover:bg-raised',
      )}
    >
      <Icon aria-hidden className="size-4 shrink-0" />
      <span className="min-w-0">{children}</span>
    </button>
  );
}

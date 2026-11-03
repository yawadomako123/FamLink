'use client';

import * as React from 'react';
import { Bell, BellOff, Loader2 } from 'lucide-react';
import { api, errorMessage } from '@/lib/api/client';
import { cn } from '@/lib/utils';

/**
 * Whether this place's comings and goings reach you.
 *
 * One control rather than two, because "arrivals but not departures" is a
 * distinction almost nobody wants and a second toggle per row would cost more
 * attention than it returns. Both flags move together here; the API keeps them
 * separate so a future screen can split them without a migration.
 *
 * Muted is the unusual state, so it is the one that gets a colour. A place
 * nobody has touched looks exactly like it did before filters existed.
 */
export function PlaceBell({
  familyId,
  placeId,
  placeName,
  initialMuted,
}: {
  familyId: string;
  placeId: string;
  placeName: string;
  /** True when this member has switched both arrivals and departures off. */
  initialMuted: boolean;
}) {
  const [muted, setMuted] = React.useState(initialMuted);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function toggle() {
    const next = !muted;
    setBusy(true);
    setError(null);
    // Optimistic: the control answers immediately and reverts if the write
    // fails, which is the same bargain the sharing switch makes.
    setMuted(next);

    try {
      await api.put(`/api/v1/families/${familyId}/places/${placeId}/watch`, {
        arrivals: !next,
        departures: !next,
      });
    } catch (err) {
      setMuted(!next);
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={busy}
      title={error ?? undefined}
      aria-pressed={muted}
      aria-label={
        muted
          ? `Turn notifications for ${placeName} back on`
          : `Mute notifications for ${placeName}`
      }
      className={cn(
        'size-8 shrink-0 rounded-lg flex items-center justify-center transition-colors',
        'disabled:opacity-50',
        error
          ? 'text-danger-600'
          : muted
            ? 'text-subtle hover:text-fg hover:bg-raised'
            : 'text-brand-600 hover:bg-raised',
      )}
    >
      {busy ? (
        <Loader2 aria-hidden className="size-4 animate-spin" />
      ) : muted ? (
        <BellOff aria-hidden className="size-4" />
      ) : (
        <Bell aria-hidden className="size-4" />
      )}
    </button>
  );
}

'use client';

import * as React from 'react';
import { Phone, Video, X } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { api, errorMessage } from '@/lib/api/client';
import { MAX_CALL_PARTICIPANTS } from '@/lib/calls/ice';
import { cn } from '@/lib/utils';
import type { CallKind } from '@/lib/db/schema';

export interface CallablePerson {
  userId: string;
  name: string;
  image: string | null;
}

/**
 * Chooses who to call.
 *
 * The API has taken a list of people since direct calls landed; this is the
 * only way to reach that from the UI with more than one name. Calling the
 * whole family stays a single tap in the header — this is for the times when
 * "everyone" is the wrong answer.
 *
 * The cap is enforced here as well as on the server, because discovering you
 * picked one person too many *after* the call fails is a bad way to find out.
 *
 * Mounted only while open, by the caller. That is what resets the selection
 * between uses — last time's choice is not a sensible default, and mounting
 * says so without an effect that writes state on open.
 */
export function CallPicker({
  familyId,
  people,
  onClose,
}: {
  familyId: string;
  people: CallablePerson[];
  onClose: () => void;
}) {
  const [selected, setSelected] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState<CallKind | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // The caller occupies one of the places, so the list has one fewer.
  const limit = MAX_CALL_PARTICIPANTS - 1;
  const atLimit = selected.length >= limit;

  function toggle(userId: string) {
    setError(null);
    setSelected((current) =>
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : current.length >= limit
          ? current
          : [...current, userId],
    );
  }

  async function start(kind: CallKind) {
    if (selected.length === 0) return;
    setBusy(kind);
    setError(null);

    try {
      await api.post(`/api/v1/families/${familyId}/calls`, { kind, inviteeIds: selected });
      // CallManager picks the call up from the realtime hint and takes over.
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Choose who to call"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={() => onClose()}
        className="absolute inset-0 bg-black/50"
      />

      <div className="relative w-full sm:max-w-md bg-card border border-line rounded-t-2xl sm:rounded-2xl shadow-lift max-h-[85dvh] flex flex-col">
        <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight">Call someone</h2>
            <p className="text-xs text-muted mt-0.5">
              {selected.length === 0
                ? `Pick up to ${limit} ${limit === 1 ? 'person' : 'people'}`
                : `${selected.length} selected`}
            </p>
          </div>

          <button
            type="button"
            onClick={() => onClose()}
            aria-label="Close"
            className="size-8 shrink-0 rounded-lg flex items-center justify-center text-subtle hover:text-fg hover:bg-raised transition-colors"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>

        {error && (
          <div className="px-5 pb-2">
            <Alert tone="error">{error}</Alert>
          </div>
        )}

        <ul className="flex-1 min-h-0 overflow-y-auto border-t border-line divide-y divide-line">
          {people.map((person) => {
            const checked = selected.includes(person.userId);
            const blocked = !checked && atLimit;

            return (
              <li key={person.userId}>
                <label
                  className={cn(
                    'flex items-center gap-3 px-5 py-3 cursor-pointer transition-colors',
                    checked ? 'bg-tint-brand' : 'hover:bg-raised',
                    blocked && 'opacity-45 cursor-not-allowed',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={blocked}
                    onChange={() => toggle(person.userId)}
                    className="size-4 shrink-0 accent-brand-600"
                  />
                  <Avatar
                    name={person.name}
                    userId={person.userId}
                    image={person.image}
                    size="sm"
                  />
                  <span className="flex-1 min-w-0 text-sm font-medium text-fg truncate">
                    {person.name}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>

        <div className="shrink-0 flex items-center gap-2 px-5 py-4 border-t border-line pb-safe">
          <Button
            fullWidth
            loading={busy === 'audio'}
            disabled={selected.length === 0 || busy !== null}
            onClick={() => void start('audio')}
          >
            <Phone aria-hidden className="size-4" />
            Voice
          </Button>

          <Button
            fullWidth
            variant="secondary"
            loading={busy === 'video'}
            disabled={selected.length === 0 || busy !== null}
            onClick={() => void start('video')}
          >
            <Video aria-hidden className="size-4" />
            Video
          </Button>
        </div>
      </div>
    </div>
  );
}

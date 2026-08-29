'use client';

import * as React from 'react';
import { Phone, PhoneOff, Video } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { useRealtime } from '@/hooks/useRealtime';
import { useRingtone } from '@/hooks/useRingtone';
import { api, errorMessage } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import type { IceConfig } from '@/lib/calls/ice';
import type { CallKind } from '@/lib/db/schema';
import { CallStage } from './call-stage';

export interface ActiveCall {
  id: string;
  familyId: string;
  kind: CallKind;
  status: 'ringing' | 'active' | 'ended' | 'missed' | 'declined';
  initiatorId: string;
  initiatorName: string;
  participants: { userId: string; name: string; image: string | null; joined: boolean }[];
}

/**
 * Watches for calls and puts the right surface on screen.
 *
 * Mounted once in the app shell rather than per page, so an incoming call
 * reaches somebody wherever they are in FamLink — a call that only rings on the
 * chat page would be worse than no call feature at all.
 */
export function CallManager({
  familyId,
  selfId,
  selfName,
}: {
  familyId: string;
  selfId: string;
  selfName: string;
}) {
  const [call, setCall] = React.useState<ActiveCall | null>(null);
  const [ice, setIce] = React.useState<IceConfig | null>(null);
  const [joined, setJoined] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  /** Set when the ringing call belongs to a family other than the one on screen. */
  const [elsewhere, setElsewhere] = React.useState<{ id: string; name: string } | null>(null);

  const refresh = React.useCallback(async () => {
    try {
      /*
       * Asks across every family, not just the one being viewed. A call in
       * another family used to produce a push notification and no in-app ring
       * at all, and the 45-second timeout usually won that race.
       */
      const result = await api.get<{
        active: ActiveCall | null;
        familyId: string | null;
        familyName: string | null;
        ice: IceConfig;
      }>('/api/v1/calls/active');

      /*
       * Identity is preserved when the servers have not actually changed. This
       * object is a dependency all the way down into the peer connections, and
       * a fresh one every poll churned them for nothing.
       */
      setIce((prev) =>
        prev && JSON.stringify(prev) === JSON.stringify(result.ice) ? prev : result.ice,
      );
      setCall(result.active);
      setElsewhere(
        result.active && result.familyId && result.familyId !== familyId
          ? { id: result.familyId, name: result.familyName ?? 'another family' }
          : null,
      );

      // The call ended elsewhere — drop out of the stage.
      if (!result.active) setJoined(false);
    } catch {
      // Transient; the next realtime hint or poll will retry.
    }
  }, [familyId]);

  const onEvent = React.useCallback(
    (type: string) => {
      if (type === 'call') void refresh();
    },
    [refresh],
  );

  useRealtime({ familyId, onEvent });

  /*
   * One effect owns fetching: an initial load plus a slow poll behind the
   * realtime stream. A missed "call ended" hint would otherwise leave somebody
   * staring at a call that finished minutes ago.
   *
   * The first load is deferred to a microtask so nothing is set synchronously
   * during the effect.
   */
  React.useEffect(() => {
    queueMicrotask(() => void refresh());

    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 15_000);

    return () => clearInterval(timer);
  }, [refresh]);

  const act = React.useCallback(
    async (action: 'join' | 'decline' | 'leave') => {
      if (!call) return;
      setBusy(true);
      setError(null);

      try {
        // The call's own family, which is not necessarily the one on screen.
        await api.post(`/api/v1/families/${call.familyId}/calls/${call.id}`, { action });

        if (action === 'join') {
          setJoined(true);

          /*
           * Answering a call in another family moves you there. Leaving the
           * app pointed at a different family than the call would make chat,
           * the map and the member list all describe the wrong household.
           */
          if (call.familyId !== familyId) {
            await api
              .post('/api/v1/families/current', { familyId: call.familyId })
              .catch(() => {});
          }
        } else {
          setJoined(false);
          setCall(null);
        }
        await refresh();
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setBusy(false);
      }
    },
    [call, familyId, refresh],
  );

  const isRinging = call?.status === 'ringing';

  /*
   * The person who placed the call is a participant from the moment it exists,
   * and the stage already plays them a ringback. Ringing at them as well
   * layered an incoming tone over an outgoing one.
   */
  const isParticipating =
    call !== null &&
    (joined || call.participants.some((p) => p.userId === selfId && p.joined));

  useRingtone('incoming', isRinging && !isParticipating);

  if (!call || !ice) return null;

  // In the call: show the stage.
  if (isParticipating) {
    return (
      <CallStage
        familyId={call.familyId}
        callId={call.id}
        kind={call.kind}
        selfId={selfId}
        selfName={selfName}
        participants={call.participants}
        isInitiator={call.initiatorId === selfId}
        ice={ice}
        onEnded={() => {
          setJoined(false);
          setCall(null);
          void refresh();
        }}
      />
    );
  }

  // Being rung, or a call is running that this member has not joined.
  return (
    <div
      role="alertdialog"
      aria-label={`${call.initiatorName} is calling`}
      className="fixed top-0 inset-x-0 z-50 p-3 pt-safe"
    >
      <div className="mx-auto max-w-sm bg-card border border-line rounded-2xl shadow-lift p-4">
        <div className="flex items-center gap-3">
          <Avatar
            name={call.initiatorName}
            userId={call.initiatorId}
            size="lg"
            className={isRinging ? 'sos-pulse' : undefined}
          />

          <div className="flex-1 min-w-0">
            <p className="font-semibold text-fg truncate">{call.initiatorName}</p>
            <p className="text-sm text-muted">
              {isRinging
                ? `Incoming ${call.kind === 'video' ? 'video' : 'voice'} call`
                : `${call.kind === 'video' ? 'Video' : 'Voice'} call in progress`}
            </p>

            {/*
              Named when it is not the family on screen, because answering
              switches you across and that should not be a surprise.
            */}
            {elsewhere && (
              <p className="text-xs text-muted mt-0.5 truncate">
                in {elsewhere.name} · answering switches you there
              </p>
            )}
          </div>
        </div>

        {error && (
          <p role="alert" className="text-xs text-danger-600 mt-3">
            {error}
          </p>
        )}

        <div className="mt-4 flex gap-2">
          <Button
            fullWidth
            loading={busy}
            onClick={() => void act('join')}
            className="bg-status-sharing hover:bg-status-sharing/90"
          >
            {call.kind === 'video' ? (
              <Video aria-hidden className="size-4" />
            ) : (
              <Phone aria-hidden className="size-4" />
            )}
            {isRinging ? 'Answer' : 'Join'}
          </Button>

          <Button variant="danger" disabled={busy} onClick={() => void act('decline')}>
            <PhoneOff aria-hidden className="size-4" />
            {isRinging ? 'Decline' : 'Dismiss'}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/** Buttons that start a call. Placed in the chat and family headers. */
export function StartCallButtons({
  familyId,
  disabled,
  compact = false,
  inviteeIds,
  labelSuffix,
}: {
  familyId: string;
  disabled?: boolean;
  compact?: boolean;
  /**
   * Who to ring. Omitted calls the whole family, which is what the chat and
   * family headers do. Naming people keeps the call private to them.
   */
  inviteeIds?: string[];
  /** Completes the button labels, e.g. "Start a voice call with Ama". */
  labelSuffix?: string;
}) {
  const [busy, setBusy] = React.useState<CallKind | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function start(kind: CallKind) {
    setBusy(kind);
    setError(null);

    try {
      await api.post(`/api/v1/families/${familyId}/calls`, {
        kind,
        ...(inviteeIds ? { inviteeIds } : {}),
      });
      // CallManager picks the call up from the realtime hint and takes over.
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={cn('flex items-center', compact ? 'gap-0.5' : 'gap-1.5')}>
      <button
        type="button"
        onClick={() => void start('audio')}
        disabled={disabled || busy !== null}
        aria-label={labelSuffix ? `Call ${labelSuffix}` : 'Start a voice call'}
        title={labelSuffix ? `Call ${labelSuffix}` : 'Start a voice call'}
        className={cn(
          'rounded-lg flex items-center justify-center text-muted transition-colors',
          'hover:text-fg hover:bg-raised disabled:opacity-50',
          compact ? 'size-8' : 'size-9',
        )}
      >
        <Phone aria-hidden className={compact ? 'size-4' : 'size-4.5'} />
      </button>

      <button
        type="button"
        onClick={() => void start('video')}
        disabled={disabled || busy !== null}
        aria-label={labelSuffix ? `Video call ${labelSuffix}` : 'Start a video call'}
        title={labelSuffix ? `Video call ${labelSuffix}` : 'Start a video call'}
        className={cn(
          'rounded-lg items-center justify-center text-muted transition-colors',
          'hover:text-fg hover:bg-raised disabled:opacity-50',
          /*
           * Shown on a phone as well. It was hidden while "Check in" also sat
           * in the row and the name was squeezed to about four characters;
           * that button now lives in the row's menu, which buys back the width
           * this needs.
           */
          compact ? 'size-8 flex' : 'size-9 flex',
        )}
      >
        <Video aria-hidden className={compact ? 'size-4' : 'size-4.5'} />
      </button>

      {error && (
        <span role="alert" className="text-xs text-danger-600 ml-1">
          {error}
        </span>
      )}
    </div>
  );
}

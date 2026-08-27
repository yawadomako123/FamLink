'use client';

import * as React from 'react';
import { Mic, MicOff, PhoneOff, Video, VideoOff, Loader2 } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Alert } from '@/components/ui/feedback';
import { useCall, type RemoteParticipant } from '@/hooks/useCall';
import type { IceConfig } from '@/lib/calls/ice';
import { cn } from '@/lib/utils';
import type { CallKind } from '@/lib/db/schema';

/**
 * The in-call screen.
 *
 * Full-screen and deliberately sparse: during a call the only things that
 * matter are seeing people and being able to hang up. Controls stay visible
 * rather than auto-hiding, because a hang-up button you have to go looking for
 * is a bad hang-up button.
 */
export function CallStage({
  familyId,
  callId,
  kind,
  selfId,
  selfName,
  participants,
  ice,
  onEnded,
}: {
  familyId: string;
  callId: string;
  kind: CallKind;
  selfId: string;
  selfName: string;
  participants: { userId: string; name: string; image: string | null; joined: boolean }[];
  ice: IceConfig;
  onEnded: () => void;
}) {
  const peerIds = React.useMemo(
    () => participants.filter((p) => p.joined && p.userId !== selfId).map((p) => p.userId),
    [participants, selfId],
  );

  const {
    phase,
    error,
    localStream,
    remotes,
    micEnabled,
    cameraEnabled,
    toggleMic,
    toggleCamera,
    hangUp,
  } = useCall({ familyId, callId, kind, selfId, peerIds, ice, active: true });

  React.useEffect(() => {
    if (phase === 'ended') onEnded();
  }, [phase, onEnded]);

  const nameFor = React.useCallback(
    (userId: string) => participants.find((p) => p.userId === userId)?.name ?? 'Someone',
    [participants],
  );

  const waiting = remotes.length === 0;

  return (
    <div className="fixed inset-0 z-50 bg-sand-950 flex flex-col">
      {/* ----------------------------------------------------------- stage -- */}
      <div className="flex-1 min-h-0 relative p-3 pt-safe">
        {error && (
          <div className="absolute top-3 left-3 right-3 z-20">
            <Alert tone="error">{error}</Alert>
          </div>
        )}

        {waiting ? (
          <div className="h-full grid place-items-center text-center px-6">
            <div>
              <div className="flex justify-center gap-2 mb-5">
                {participants
                  .filter((p) => p.userId !== selfId)
                  .slice(0, 3)
                  .map((p) => (
                    <Avatar key={p.userId} name={p.name} userId={p.userId} image={p.image} size="xl" />
                  ))}
              </div>

              <p className="text-white font-semibold text-lg">
                {phase === 'requesting-media'
                  ? 'Getting ready…'
                  : phase === 'failed'
                    ? 'Call failed'
                    : 'Ringing…'}
              </p>

              {phase !== 'failed' && (
                <p className="text-white/60 text-sm mt-1.5 inline-flex items-center gap-2">
                  <Loader2 aria-hidden className="size-3.5 animate-spin" />
                  Waiting for someone to answer
                </p>
              )}
            </div>
          </div>
        ) : (
          <div
            className={cn(
              'h-full grid gap-3',
              remotes.length === 1 ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2',
            )}
          >
            {remotes.map((remote) => (
              <RemoteTile key={remote.userId} remote={remote} name={nameFor(remote.userId)} />
            ))}
          </div>
        )}

        {/* Local preview. Audio calls have no video to show. */}
        {kind === 'video' && localStream && (
          <div className="absolute bottom-3 right-3 w-28 sm:w-40 aspect-[3/4] rounded-xl overflow-hidden border-2 border-white/20 shadow-lift bg-sand-900">
            <LocalVideo stream={localStream} muted enabled={cameraEnabled} name={selfName} />
          </div>
        )}
      </div>

      {/* -------------------------------------------------------- controls -- */}
      <div className="shrink-0 flex items-center justify-center gap-3 px-4 py-5 pb-safe bg-black/40">
        <ControlButton
          label={micEnabled ? 'Mute microphone' : 'Unmute microphone'}
          active={micEnabled}
          onClick={toggleMic}
          icon={micEnabled ? Mic : MicOff}
        />

        {kind === 'video' && (
          <ControlButton
            label={cameraEnabled ? 'Turn camera off' : 'Turn camera on'}
            active={cameraEnabled}
            onClick={toggleCamera}
            icon={cameraEnabled ? Video : VideoOff}
          />
        )}

        <button
          type="button"
          onClick={() => void hangUp()}
          aria-label="Leave call"
          className="size-14 rounded-full bg-danger-600 hover:bg-danger-700 text-white flex items-center justify-center transition-colors"
        >
          <PhoneOff aria-hidden className="size-6" />
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function ControlButton({
  label,
  active,
  onClick,
  icon: Icon,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  icon: React.ElementType;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={!active}
      className={cn(
        'size-14 rounded-full flex items-center justify-center transition-colors',
        active ? 'bg-white/15 text-white hover:bg-white/25' : 'bg-white text-sand-900',
      )}
    >
      <Icon aria-hidden className="size-6" />
    </button>
  );
}

function RemoteTile({ remote, name }: { remote: RemoteParticipant; name: string }) {
  const ref = React.useRef<HTMLVideoElement>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (el && el.srcObject !== remote.stream) el.srcObject = remote.stream;
  }, [remote.stream]);

  const hasVideo = remote.cameraEnabled && remote.stream.getVideoTracks().length > 0;
  const connecting = remote.connectionState !== 'connected';
  const isMuted = !remote.micEnabled;

  return (
    <div className="relative rounded-2xl overflow-hidden bg-sand-900 min-h-0">
      <video
        ref={ref}
        autoPlay
        playsInline
        className={cn('h-full w-full object-cover', !hasVideo && 'hidden')}
      />

      {!hasVideo && (
        <div className="absolute inset-0 grid place-items-center">
          <Avatar name={name} userId={remote.userId} size="xl" />
        </div>
      )}

      <div className="absolute bottom-2 left-2 flex items-center gap-1.5 px-2 py-1 rounded-lg bg-black/55 backdrop-blur-sm">
        <span className="text-xs font-medium text-white">{name}</span>
        {isMuted && <MicOff aria-hidden className="size-3 text-danger-500" />}
        {connecting && <Loader2 aria-hidden className="size-3 animate-spin text-white/70" />}
      </div>
    </div>
  );
}

function LocalVideo({
  stream,
  muted,
  enabled,
  name,
}: {
  stream: MediaStream;
  muted: boolean;
  enabled: boolean;
  name: string;
}) {
  const ref = React.useRef<HTMLVideoElement>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (el && el.srcObject !== stream) el.srcObject = stream;
  }, [stream]);

  return (
    <>
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={muted}
        // Mirrored, because an un-mirrored self-view feels wrong to everyone.
        className={cn('h-full w-full object-cover scale-x-[-1]', !enabled && 'hidden')}
      />
      {!enabled && (
        <div className="absolute inset-0 grid place-items-center">
          <Avatar name={name} size="md" />
        </div>
      )}
    </>
  );
}

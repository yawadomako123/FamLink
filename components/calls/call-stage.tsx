'use client';

import * as React from 'react';
import {
  Loader2,
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  ScreenShare,
  SwitchCamera,
  Video,
  VideoOff,
  Volume2,
} from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Alert } from '@/components/ui/feedback';
import { useCall, type RemoteParticipant } from '@/hooks/useCall';
import { applyAudioOutput, useAudioOutput } from '@/hooks/useAudioOutput';
import { useRingtone } from '@/hooks/useRingtone';
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
  isInitiator,
  ice,
  onEnded,
}: {
  familyId: string;
  callId: string;
  kind: CallKind;
  selfId: string;
  selfName: string;
  participants: { userId: string; name: string; image: string | null; joined: boolean }[];
  /** Only the caller hears a ringback; the answerer is already through. */
  isInitiator: boolean;
  ice: IceConfig;
  onEnded: () => void;
}) {
  /*
   * Keyed on the ids themselves, not the participants array. That array is
   * rebuilt by every poll, and a new peerIds array on each one re-ran the peer
   * lifecycle and re-created the signalling callbacks several times a minute.
   */
  const peerKey = participants
    .filter((p) => p.joined && p.userId !== selfId)
    .map((p) => p.userId)
    .sort()
    .join(',');

  const peerIds = React.useMemo(
    () => (peerKey === '' ? [] : peerKey.split(',')),
    [peerKey],
  );

  const {
    phase,
    error,
    localStream,
    screenStream,
    remotes,
    micEnabled,
    cameraEnabled,
    screenSharing,
    canSwitchCamera,
    canShareScreen,
    facingMode,
    toggleMic,
    toggleCamera,
    toggleScreenShare,
    switchCamera,
    hangUp,
  } = useCall({ familyId, callId, kind, selfId, peerIds, ice, active: true });

  const audioOutput = useAudioOutput(phase === 'connected');

  const isConnecting = phase === 'requesting-media' || phase === 'connecting';
  useRingtone('outgoing', isInitiator && isConnecting && remotes.length === 0);

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
              <RemoteTile
                key={remote.userId}
                remote={remote}
                name={nameFor(remote.userId)}
                outputDeviceId={audioOutput.deviceId}
              />
            ))}
          </div>
        )}

        {/*
          Local preview. A voice call has nothing to preview — until its owner
          starts sharing a screen, which they should be able to see going out.
        */}
        {(screenStream ?? (kind === 'video' ? localStream : null)) && (
          <div
            className={cn(
              'absolute bottom-3 right-3 rounded-xl overflow-hidden border-2 border-white/20 shadow-lift bg-sand-900',
              // A shared screen is landscape and unreadable in a portrait box.
              // Kept narrow on a phone all the same: at 375px a 160px preview
              // is half the screen, and it sits on top of the person talking.
              screenStream ? 'w-32 sm:w-56 aspect-video' : 'w-28 sm:w-40 aspect-[3/4]',
            )}
          >
            <LocalVideo
              stream={screenStream ?? localStream!}
              enabled={screenStream !== null || cameraEnabled}
              sharing={screenStream !== null}
              // The rear camera shows the world, and mirroring the world is
              // disorienting. Only a self-view is mirrored.
              mirrored={screenStream === null && facingMode === 'user'}
              name={selfName}
            />
          </div>
        )}
      </div>

      {/* -------------------------------------------------------- controls -- */}
      <div className="shrink-0 flex flex-wrap items-center justify-center gap-2 sm:gap-3 px-4 py-5 pb-safe bg-black/40">
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
            // While a screen is going out, the camera is not what anyone sees.
            disabled={screenSharing}
            onClick={toggleCamera}
            icon={cameraEnabled ? Video : VideoOff}
          />
        )}

        {canSwitchCamera && (
          <ControlButton
            label={facingMode === 'user' ? 'Switch to rear camera' : 'Switch to front camera'}
            active
            onClick={() => void switchCamera()}
            icon={SwitchCamera}
          />
        )}

        {canShareScreen && (
          <ControlButton
            label={screenSharing ? 'Stop sharing your screen' : 'Share your screen'}
            active={!screenSharing}
            onClick={() => void toggleScreenShare()}
            icon={screenSharing ? ScreenShare : MonitorUp}
          />
        )}

        {audioOutput.supported && (
          <AudioOutputPicker
            devices={audioOutput.devices}
            deviceId={audioOutput.deviceId}
            onSelect={audioOutput.select}
          />
        )}

        <button
          type="button"
          onClick={() => void hangUp()}
          aria-label="Leave call"
          className="size-12 sm:size-14 rounded-full bg-danger-600 hover:bg-danger-700 text-white flex items-center justify-center transition-colors"
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
  disabled,
  onClick,
  icon: Icon,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  icon: React.ElementType;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      aria-pressed={!active}
      className={cn(
        'size-12 sm:size-14 rounded-full flex items-center justify-center transition-colors',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        active ? 'bg-white/15 text-white hover:bg-white/25' : 'bg-white text-sand-900',
      )}
    >
      <Icon aria-hidden className="size-6" />
    </button>
  );
}

/**
 * Output picker.
 *
 * A native `<select>` rather than a custom menu: it is one control used rarely,
 * and the platform's own picker is the one that works with a screen reader and
 * on a touch screen without any of this having to reimplement it.
 */
function AudioOutputPicker({
  devices,
  deviceId,
  onSelect,
}: {
  devices: { deviceId: string; label: string }[];
  deviceId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="relative size-12 sm:size-14">
      <div
        aria-hidden
        className="absolute inset-0 rounded-full bg-white/15 text-white flex items-center justify-center"
      >
        <Volume2 className="size-6" />
      </div>

      <select
        aria-label="Choose where call audio plays"
        title="Choose where call audio plays"
        value={deviceId}
        onChange={(event) => onSelect(event.target.value)}
        // Transparent over the icon: the platform's picker, our appearance.
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
      >
        <option value="">Default output</option>
        {devices.map((device) => (
          <option key={device.deviceId} value={device.deviceId}>
            {device.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function RemoteTile({
  remote,
  name,
  outputDeviceId,
}: {
  remote: RemoteParticipant;
  name: string;
  outputDeviceId: string;
}) {
  const ref = React.useRef<HTMLVideoElement>(null);
  const isMuted = !remote.micEnabled;

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (el.srcObject !== remote.stream) el.srcObject = remote.stream;
    el.muted = isMuted;

    /*
     * autoplay is a request, not a guarantee: unmuting an element the browser
     * started under a muted allowance can pause it. Asking again is harmless
     * when it is already playing, and is the difference between hearing
     * somebody and silence after they unmute.
     */
    void el.play().catch(() => {});
  }, [remote.stream, isMuted]);

  React.useEffect(() => {
    const el = ref.current;
    if (el) applyAudioOutput(el, outputDeviceId);
  }, [outputDeviceId]);

  /*
   * Start playing again on the way back into the app.
   *
   * iOS pauses media elements when the page stops being frontmost, and does
   * not always resume them on return — the call was still connected but the
   * other person stayed silent until something touched the element. Declaring
   * the audio session keeps most of this from happening; this catches the rest.
   */
  React.useEffect(() => {
    const resume = () => {
      if (document.visibilityState !== 'visible') return;
      const el = ref.current;
      if (el?.paused) void el.play().catch(() => {});
    };

    document.addEventListener('visibilitychange', resume);
    window.addEventListener('focus', resume);
    window.addEventListener('pageshow', resume);

    return () => {
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('focus', resume);
      window.removeEventListener('pageshow', resume);
    };
  }, []);

  // A shared screen arrives on the same track as a camera would, so the
  // sender's own word is what distinguishes them.
  const showing = remote.cameraEnabled || remote.screenSharing;
  const hasVideo = showing && remote.stream.getVideoTracks().length > 0;
  const connecting = remote.connectionState !== 'connected';

  return (
    <div className="relative rounded-2xl overflow-hidden bg-sand-900 min-h-0">
      {/*
        Hidden with opacity rather than `display: none`. This element carries
        the remote audio as well as the video, and a display:none media element
        does not reliably play on iOS Safari — which silences every voice call
        and every video call where the other side turned their camera off.
      */}
      <video
        ref={ref}
        autoPlay
        playsInline
        className={cn(
          'h-full w-full transition-opacity',
          // Cropping a face is fine; cropping a shared screen cuts off the
          // thing being pointed at.
          remote.screenSharing ? 'object-contain' : 'object-cover',
          !hasVideo && 'opacity-0',
        )}
      />

      {!hasVideo && (
        <div className="absolute inset-0 grid place-items-center bg-sand-900">
          <div className="text-center">
            <Avatar name={name} userId={remote.userId} size="xl" />

            {/*
              Says the call is still up.
              
              A tile that goes to a bare avatar the moment somebody turns their
              camera off looks exactly like a call that has dropped, and on iOS
              — where the camera light going out is the other visible change —
              that is what it was being read as.
            */}
            <p className="mt-3 text-xs text-white/60">
              {connecting ? 'Reconnecting…' : 'Camera off · still connected'}
            </p>
          </div>
        </div>
      )}

      {/* Capped, because the local preview sits in the opposite corner and a
          long name would otherwise run underneath it. */}
      <div className="absolute bottom-2 left-2 max-w-[45%] sm:max-w-[60%] flex items-center gap-1.5 px-2 py-1 rounded-lg bg-black/55 backdrop-blur-sm">
        <span className="text-xs font-medium text-white truncate">{name}</span>
        {remote.screenSharing && (
          <ScreenShare aria-label="sharing their screen" className="size-3 shrink-0 text-white/80" />
        )}
        {isMuted && <MicOff aria-hidden className="size-3 shrink-0 text-danger-500" />}
        {connecting && (
          <Loader2 aria-hidden className="size-3 shrink-0 animate-spin text-white/70" />
        )}
      </div>
    </div>
  );
}

function LocalVideo({
  stream,
  enabled,
  sharing,
  mirrored,
  name,
}: {
  stream: MediaStream;
  enabled: boolean;
  sharing: boolean;
  mirrored: boolean;
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
        // Always: this is our own microphone coming back at us otherwise.
        muted
        className={cn(
          'h-full w-full',
          sharing ? 'object-contain' : 'object-cover',
          // An un-mirrored self-view feels wrong to everyone — but a rear
          // camera and a shared screen are not self-views.
          mirrored && 'scale-x-[-1]',
          !enabled && 'hidden',
        )}
      />
      {!enabled && (
        <div className="absolute inset-0 grid place-items-center">
          <Avatar name={name} size="md" />
        </div>
      )}

      {sharing && (
        <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded-md bg-black/60 text-[10px] font-medium text-white">
          Your screen
        </span>
      )}
    </>
  );
}

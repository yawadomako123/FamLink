'use client';

import * as React from 'react';
import { api, errorMessage } from '@/lib/api/client';
import {
  describeConnectionFailure,
  displayConstraints,
  mediaConstraints,
  videoConstraints,
  type IceConfig,
} from '@/lib/calls/ice';
import type { SignalKind } from '@/lib/calls/signals';
import type { CallKind } from '@/lib/db/schema';

/**
 * WebRTC call management.
 *
 * A full mesh: every participant holds one RTCPeerConnection per peer. That is
 * the right shape for a family call of two to four — no server touches the
 * media, so there is nothing to scale and nothing to eavesdrop on — and it is
 * why the participant count is capped rather than allowed to degrade.
 *
 * **Who offers.** Both peers learn about each other at the same moment, so
 * without a rule both would send an offer and collide. The tie-break is a
 * string comparison of user ids: the lexicographically smaller id offers, the
 * larger answers. Arbitrary, but both sides compute the same answer from data
 * they already have, with no extra round trip.
 */

export type CallPhase =
  | 'idle'
  | 'requesting-media'
  | 'ringing'
  | 'connecting'
  | 'connected'
  | 'failed'
  | 'ended';

export interface RemoteParticipant {
  userId: string;
  stream: MediaStream;
  connectionState: RTCPeerConnectionState;
  cameraEnabled: boolean;
  micEnabled: boolean;
  /** Their video is a shared screen, which is framed differently to a face. */
  screenSharing: boolean;
}

/** What a peer announces about its own media. */
interface MediaState {
  camera: boolean;
  mic: boolean;
  screen: boolean;
}

export interface UseCallResult {
  phase: CallPhase;
  error: string | null;
  localStream: MediaStream | null;
  /** The screen being shared, for the local preview. Null when not sharing. */
  screenStream: MediaStream | null;
  remotes: RemoteParticipant[];
  micEnabled: boolean;
  cameraEnabled: boolean;
  screenSharing: boolean;
  /** False where the device has one camera, or the browser has no picker. */
  canSwitchCamera: boolean;
  canShareScreen: boolean;
  /** 'environment' means the rear camera, which must not be mirrored. */
  facingMode: 'user' | 'environment';
  toggleMic: () => void;
  toggleCamera: () => void;
  toggleScreenShare: () => Promise<void>;
  switchCamera: () => Promise<void>;
  hangUp: () => Promise<void>;
}

interface Peer {
  connection: RTCPeerConnection;
  stream: MediaStream;
  /** Queued until the remote description exists — ICE can arrive first. */
  pendingCandidates: RTCIceCandidateInit[];
  /**
   * The sender carrying our outbound video, whether that is the camera or a
   * shared screen. Held so swapping between them is a `replaceTrack` rather
   * than a renegotiation.
   */
  videoSender: RTCRtpSender | null;
}

/** How often to drain signalling while a call is being set up. */
const SIGNAL_POLL_MS = 700;

/** How long a non-fatal problem — a camera that would not switch — is shown. */
const FLASH_ERROR_MS = 4000;

export function useCall({
  familyId,
  callId,
  kind,
  selfId,
  peerIds,
  ice,
  active,
}: {
  familyId: string;
  callId: string | null;
  kind: CallKind;
  selfId: string;
  /** Other members currently in the call. */
  peerIds: string[];
  ice: IceConfig | null;
  active: boolean;
}): UseCallResult {
  const [phase, setPhase] = React.useState<CallPhase>('idle');
  const [error, setError] = React.useState<string | null>(null);
  const [localStream, setLocalStream] = React.useState<MediaStream | null>(null);
  const [remotes, setRemotes] = React.useState<RemoteParticipant[]>([]);
  const [micEnabled, setMicEnabled] = React.useState(true);
  const [cameraEnabled, setCameraEnabled] = React.useState(kind === 'video');
  const [screenStream, setScreenStream] = React.useState<MediaStream | null>(null);
  const [cameraCount, setCameraCount] = React.useState(0);
  const [facingMode, setFacingMode] = React.useState<'user' | 'environment'>('user');

  const peersRef = React.useRef<Map<string, Peer>>(new Map());
  const localStreamRef = React.useRef<MediaStream | null>(null);
  const screenStreamRef = React.useRef<MediaStream | null>(null);
  const cursorRef = React.useRef(0);
  const flashTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  /*
   * Mic/camera/screen flags that arrived before the peer had a tile to put
   * them on. A peer who joins already muted announces it once; without
   * somewhere to park that announcement it is lost and they show as unmuted
   * for the rest of the call.
   */
  const pendingMediaRef = React.useRef<Map<string, MediaState>>(new Map());

  /* ------------------------------------------------------------ teardown -- */

  const teardown = React.useCallback(() => {
    for (const peer of peersRef.current.values()) {
      peer.connection.onicecandidate = null;
      peer.connection.ontrack = null;
      peer.connection.onconnectionstatechange = null;
      peer.connection.close();
    }
    peersRef.current.clear();
    pendingMediaRef.current.clear();

    if (flashTimerRef.current) {
      clearTimeout(flashTimerRef.current);
      flashTimerRef.current = null;
    }

    // Releasing tracks is what actually turns the camera light off — and ends
    // the browser's own "you are sharing your screen" bar.
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;

    screenStreamRef.current?.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    screenStreamRef.current = null;

    setLocalStream(null);
    setScreenStream(null);
    setRemotes([]);
    cursorRef.current = 0;
  }, []);

  /**
   * Reports a problem that does not end the call, and clears it again.
   *
   * A camera that refuses to switch must be visible, but it must not leave a
   * red banner over a working call for the next twenty minutes.
   */
  const flashError = React.useCallback((message: string) => {
    setError(message);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setError(null), FLASH_ERROR_MS);
  }, []);

  /* ------------------------------------------------------- media state io -- */

  /**
   * What this participant is currently sending, read from the tracks
   * themselves rather than from React state — callers of this are event
   * handlers that may hold a stale render's values.
   */
  const currentMediaState = React.useCallback((): MediaState => {
    const sharing = screenStreamRef.current !== null;
    return {
      // While a screen is shared it is the screen the peers receive, so the
      // camera is reported off however the local camera track is set.
      camera: !sharing && (localStreamRef.current?.getVideoTracks()[0]?.enabled ?? false),
      mic: localStreamRef.current?.getAudioTracks()[0]?.enabled ?? false,
      screen: sharing,
    };
  }, []);

  /** Points every peer's outbound video at a different track, or at nothing. */
  const replaceOutboundVideo = React.useCallback((track: MediaStreamTrack | null) => {
    for (const peer of peersRef.current.values()) {
      peer.videoSender?.replaceTrack(track).catch((err) => {
        console.warn('[call] could not replace outbound video', err);
      });
    }
  }, []);

  /* ------------------------------------------------------- signalling io -- */

  const postSignal = React.useCallback(
    async (toUserId: string, signalKind: SignalKind, payload: Record<string, unknown>) => {
      if (!callId) return;
      try {
        await api.post(`/api/v1/families/${familyId}/calls/${callId}/signals`, {
          toUserId,
          kind: signalKind,
          payload,
        });
      } catch (err) {
        /*
         * A dropped ICE candidate is survivable — ICE retries with the rest.
         * A dropped offer, answer or media-state is not, so it is logged: a
         * rejected media-state is exactly how mute stopped reaching peers.
         */
        if (signalKind !== 'ice') console.warn(`[call] ${signalKind} signal failed`, err);
      }
    },
    [familyId, callId],
  );

  const broadcastSignal = React.useCallback(
    (signalKind: SignalKind, payload: Record<string, unknown>) => {
      for (const peerId of peerIds) {
        void postSignal(peerId, signalKind, payload);
      }
    },
    [peerIds, postSignal],
  );

  /* ------------------------------------------------------------ peering -- */

  const createPeer = React.useCallback(
    (peerId: string): Peer | null => {
      if (!ice) return null;

      const existing = peersRef.current.get(peerId);
      if (existing) return existing;

      const connection = new RTCPeerConnection({ iceServers: ice.iceServers });
      const stream = new MediaStream();

      let videoSender: RTCRtpSender | null = null;
      const local = localStreamRef.current;

      if (local) {
        for (const track of local.getTracks()) {
          const sender = connection.addTrack(track, local);
          if (track.kind === 'video') videoSender = sender;
        }
      }

      /*
       * A voice call has no camera and so no video m-line, which would make
       * screen sharing later a renegotiation. Reserving an empty video
       * transceiver up front costs one unused m-line and turns starting a
       * share into a `replaceTrack` that needs no new offer at all.
       */
      if (!videoSender) {
        videoSender = connection.addTransceiver('video', { direction: 'sendrecv' }).sender;
      }

      // A peer joining mid-share must receive the screen, not the camera.
      const sharedTrack = screenStreamRef.current?.getVideoTracks()[0];
      if (sharedTrack) {
        void videoSender.replaceTrack(sharedTrack).catch(() => {});
      }

      connection.onicecandidate = (event) => {
        if (event.candidate) {
          void postSignal(peerId, 'ice', { candidate: event.candidate.toJSON() });
        }
      };

      connection.ontrack = (event) => {
        event.streams[0]?.getTracks().forEach((track) => stream.addTrack(track));

        setRemotes((current) => {
          const existing = current.find((r) => r.userId === peerId);
          const announced = pendingMediaRef.current.get(peerId);

          /*
           * ontrack fires once per track, so a video call raises it twice. It
           * must therefore carry forward what is already known about the peer
           * rather than reset to "everything on" — otherwise the second track
           * un-mutes a peer who muted between the two.
           */
          return [
            ...current.filter((r) => r.userId !== peerId),
            {
              userId: peerId,
              stream,
              connectionState: connection.connectionState,
              cameraEnabled: announced?.camera ?? existing?.cameraEnabled ?? true,
              micEnabled: announced?.mic ?? existing?.micEnabled ?? true,
              screenSharing: announced?.screen ?? existing?.screenSharing ?? false,
            },
          ];
        });
      };

      connection.onconnectionstatechange = () => {
        const state = connection.connectionState;

        setRemotes((current) =>
          current.map((r) => (r.userId === peerId ? { ...r, connectionState: state } : r)),
        );

        if (state === 'connected') {
          setPhase('connected');
          setError(null);

          // A peer that has just connected knows nothing about what we muted
          // before they arrived, so tell them once, here.
          void postSignal(peerId, 'media-state', { ...currentMediaState() });
        }

        /*
         * A failed connection here almost always means no network path could
         * be found, so say that rather than leaving the UI on "Connecting…".
         */
        if (state === 'failed') {
          setError(describeConnectionFailure(ice.hasRelay));
          setPhase('failed');
        }
      };

      const peer: Peer = { connection, stream, pendingCandidates: [], videoSender };
      peersRef.current.set(peerId, peer);
      return peer;
    },
    [ice, postSignal, currentMediaState],
  );

  const offerTo = React.useCallback(
    async (peerId: string) => {
      const peer = createPeer(peerId);
      if (!peer) return;

      try {
        const offer = await peer.connection.createOffer();
        await peer.connection.setLocalDescription(offer);
        await postSignal(peerId, 'offer', { sdp: offer.sdp, type: offer.type });
      } catch (err) {
        console.error('[call] offer failed', err);
      }
    },
    [createPeer, postSignal],
  );

  const handleSignal = React.useCallback(
    async (signal: { fromUserId: string; kind: string; payload: Record<string, unknown> }) => {
      const peer = createPeer(signal.fromUserId);
      if (!peer) return;

      try {
        if (signal.kind === 'offer') {
          await peer.connection.setRemoteDescription({
            type: 'offer',
            sdp: String(signal.payload.sdp),
          });

          // Candidates that arrived before the description could be applied.
          for (const candidate of peer.pendingCandidates) {
            await peer.connection.addIceCandidate(candidate).catch(() => {});
          }
          peer.pendingCandidates = [];

          const answer = await peer.connection.createAnswer();
          await peer.connection.setLocalDescription(answer);
          await postSignal(signal.fromUserId, 'answer', {
            sdp: answer.sdp,
            type: answer.type,
          });
          return;
        }

        if (signal.kind === 'answer') {
          await peer.connection.setRemoteDescription({
            type: 'answer',
            sdp: String(signal.payload.sdp),
          });

          for (const candidate of peer.pendingCandidates) {
            await peer.connection.addIceCandidate(candidate).catch(() => {});
          }
          peer.pendingCandidates = [];
          return;
        }

        if (signal.kind === 'ice') {
          const candidate = signal.payload.candidate as RTCIceCandidateInit | undefined;
          if (!candidate) return;

          // addIceCandidate throws if there is no remote description yet.
          if (peer.connection.remoteDescription) {
            await peer.connection.addIceCandidate(candidate).catch(() => {});
          } else {
            peer.pendingCandidates.push(candidate);
          }
          return;
        }

        if (signal.kind === 'media-state') {
          const state: MediaState = {
            camera: Boolean(signal.payload.camera),
            mic: Boolean(signal.payload.mic),
            screen: Boolean(signal.payload.screen),
          };

          // Recorded as well as applied: the tile may not exist yet, and the
          // peer will not repeat itself.
          pendingMediaRef.current.set(signal.fromUserId, state);

          setRemotes((current) =>
            current.map((r) =>
              r.userId === signal.fromUserId
                ? {
                    ...r,
                    cameraEnabled: state.camera,
                    micEnabled: state.mic,
                    screenSharing: state.screen,
                  }
                : r,
            ),
          );
          return;
        }
      } catch (err) {
        console.error('[call] signal handling failed', err);
      }
    },
    [createPeer, postSignal],
  );

  /* ---------------------------------------------------------- media init -- */

  /*
   * Deliberately a boolean rather than `ice` itself.
   *
   * The ICE config is re-fetched on a poll, so its object identity changes
   * every few seconds even when the servers are identical. Depending on the
   * object restarted this effect mid-call: a second getUserMedia stream
   * replaced the first in `localStreamRef` while the peer connections went on
   * sending the original tracks — so the camera light stayed on for a stream
   * nobody could see, and muting toggled a track that was not being sent.
   * Media is acquired once per call; only whether ICE has arrived matters.
   */
  const iceReady = ice !== null;

  React.useEffect(() => {
    if (!active || !callId || !iceReady) return;

    let cancelled = false;

    const start = async () => {
      /*
       * A stream already in hand is the one the peer connections are sending.
       * Asking the device for a second one would strand it.
       */
      const held = localStreamRef.current;
      if (held && held.getTracks().some((t) => t.readyState === 'live')) {
        setLocalStream(held);
        setPhase('connecting');
        return;
      }

      setPhase('requesting-media');
      setError(null);

      try {
        const stream = await navigator.mediaDevices.getUserMedia(mediaConstraints(kind));
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        localStreamRef.current = stream;
        setLocalStream(stream);
        setFacingMode(
          stream.getVideoTracks()[0]?.getSettings().facingMode === 'environment'
            ? 'environment'
            : 'user',
        );
        setPhase('connecting');

        /*
         * Deliberately after getUserMedia. Before permission is granted the
         * device list is anonymised and often collapsed to a single entry, so
         * counting cameras any earlier hides the switch button on phones that
         * plainly have two.
         */
        void navigator.mediaDevices
          .enumerateDevices()
          .then((devices) => {
            if (!cancelled) {
              setCameraCount(devices.filter((d) => d.kind === 'videoinput').length);
            }
          })
          .catch(() => {});
      } catch (err) {
        if (cancelled) return;

        const name = err instanceof Error ? err.name : '';
        setError(
          name === 'NotAllowedError'
            ? `FamLink needs permission to use your ${kind === 'video' ? 'camera and microphone' : 'microphone'}. Allow access in your browser, then try again.`
            : name === 'NotFoundError'
              ? `No ${kind === 'video' ? 'camera or microphone' : 'microphone'} was found on this device.`
              : 'Could not access your microphone or camera.',
        );
        setPhase('failed');
      }
    };

    void start();

    return () => {
      cancelled = true;
    };
  }, [active, callId, kind, iceReady]);

  /* ------------------------------------------------------- peer lifecycle -- */

  React.useEffect(() => {
    if (phase !== 'connecting' && phase !== 'connected') return;
    if (!localStream) return;

    for (const peerId of peerIds) {
      if (peersRef.current.has(peerId)) continue;

      // Deterministic tie-break so exactly one side offers. Both peers derive
      // the same answer from ids they already hold.
      if (selfId < peerId) void offerTo(peerId);
      else createPeer(peerId);
    }

    // Drop peers who have left.
    for (const [peerId, peer] of peersRef.current) {
      if (!peerIds.includes(peerId)) {
        peer.connection.close();
        peersRef.current.delete(peerId);
        pendingMediaRef.current.delete(peerId);
        setRemotes((current) => current.filter((r) => r.userId !== peerId));
      }
    }
  }, [peerIds, phase, localStream, selfId, offerTo, createPeer]);

  /* ----------------------------------------------------------- signal loop -- */

  React.useEffect(() => {
    if (!active || !callId) return;
    if (phase !== 'connecting' && phase !== 'connected') return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const drain = async () => {
      try {
        const result = await api.get<{
          signals: { id: number; fromUserId: string; kind: string; payload: Record<string, unknown> }[];
        }>(
          `/api/v1/families/${familyId}/calls/${callId}/signals?after=${cursorRef.current}`,
        );

        for (const signal of result.signals) {
          cursorRef.current = Math.max(cursorRef.current, signal.id);
          await handleSignal(signal);
        }
      } catch {
        // Transient; the next tick retries.
      } finally {
        if (!cancelled) timer = setTimeout(() => void drain(), SIGNAL_POLL_MS);
      }
    };

    void drain();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [active, callId, familyId, phase, handleSignal]);

  /* --------------------------------------------------------------- exits -- */

  /*
   * Teardown runs as cleanup, which covers both the call ending and the
   * component unmounting. Releasing the tracks is not optional: a camera light
   * that stays on after a call is alarming, and on some devices it locks the
   * device against other apps.
   */
  React.useEffect(() => {
    if (!active) return;
    return teardown;
  }, [active, teardown]);

  const hangUp = React.useCallback(async () => {
    if (callId) {
      try {
        await api.post(`/api/v1/families/${familyId}/calls/${callId}`, { action: 'leave' });
      } catch (err) {
        setError(errorMessage(err));
      }
    }
    teardown();
    setPhase('ended');
  }, [familyId, callId, teardown]);

  /** Tells every peer what we are sending, after changing what we send. */
  const announce = React.useCallback(() => {
    broadcastSignal('media-state', { ...currentMediaState() });
  }, [broadcastSignal, currentMediaState]);

  const toggleMic = React.useCallback(() => {
    if (!localStreamRef.current) return;
    const audioTracks = localStreamRef.current.getAudioTracks();
    const firstTrack = audioTracks[0];
    if (!firstTrack) return;

    const newState = !firstTrack.enabled;
    audioTracks.forEach((t) => (t.enabled = newState));
    setMicEnabled(newState);
    announce();
  }, [announce]);

  const toggleCamera = React.useCallback(() => {
    if (!localStreamRef.current) return;
    const videoTracks = localStreamRef.current.getVideoTracks();
    const firstTrack = videoTracks[0];
    if (!firstTrack) return;

    const newState = !firstTrack.enabled;
    videoTracks.forEach((t) => (t.enabled = newState));
    setCameraEnabled(newState);
    announce();
  }, [announce]);

  /* --------------------------------------------------------- screen share -- */

  const stopScreenShare = React.useCallback(() => {
    const shared = screenStreamRef.current;
    if (!shared) return;

    shared.getTracks().forEach((track) => {
      // Cleared first: stopping the track would otherwise re-enter here.
      track.onended = null;
      track.stop();
    });
    screenStreamRef.current = null;
    setScreenStream(null);

    // Back to the camera, or to nothing at all on a voice call.
    replaceOutboundVideo(localStreamRef.current?.getVideoTracks()[0] ?? null);
    announce();
  }, [replaceOutboundVideo, announce]);

  const toggleScreenShare = React.useCallback(async () => {
    if (screenStreamRef.current) {
      stopScreenShare();
      return;
    }

    if (typeof navigator.mediaDevices?.getDisplayMedia !== 'function') {
      flashError('This browser cannot share a screen. Try a desktop browser.');
      return;
    }

    try {
      const display = await navigator.mediaDevices.getDisplayMedia(displayConstraints());
      const track = display.getVideoTracks()[0];

      if (!track) {
        display.getTracks().forEach((t) => t.stop());
        return;
      }

      /*
       * Browsers put their own "Stop sharing" bar over the page, and people
       * use it. Without this the share would end for us and go on looking
       * live to everyone else.
       */
      track.onended = () => stopScreenShare();

      screenStreamRef.current = display;
      setScreenStream(display);
      replaceOutboundVideo(track);
      announce();
    } catch (err) {
      // Dismissing the picker raises NotAllowedError. That is a decision, not
      // a failure, and reporting it as one would be wrong.
      if (err instanceof Error && err.name !== 'NotAllowedError') {
        flashError('Could not start screen sharing.');
      }
    }
  }, [stopScreenShare, replaceOutboundVideo, announce, flashError]);

  /* -------------------------------------------------------- camera switch -- */

  /**
   * Moves to the next camera on the device.
   *
   * By device id rather than by `facingMode`: a phone reports front and rear,
   * but a laptop with two webcams reports neither, and `{ facingMode: exact }`
   * throws outright on hardware that does not label its cameras.
   */
  const switchCamera = React.useCallback(async () => {
    const local = localStreamRef.current;
    const currentTrack = local?.getVideoTracks()[0];
    if (!local || !currentTrack) return;

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cameras = devices.filter((d) => d.kind === 'videoinput');
      if (cameras.length < 2) return;

      const currentId = currentTrack.getSettings().deviceId;
      const index = cameras.findIndex((c) => c.deviceId === currentId);
      const next = cameras[(index + 1) % cameras.length];
      if (!next) return;

      const fresh = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints(next.deviceId),
        audio: false,
      });
      const track = fresh.getVideoTracks()[0];

      if (!track) {
        fresh.getTracks().forEach((t) => t.stop());
        return;
      }

      // A camera switch must not un-mute a camera the caller turned off.
      track.enabled = currentTrack.enabled;

      local.removeTrack(currentTrack);
      currentTrack.stop();
      local.addTrack(track);

      // Peers watching a shared screen must keep watching it.
      if (!screenStreamRef.current) replaceOutboundVideo(track);

      setFacingMode(track.getSettings().facingMode === 'environment' ? 'environment' : 'user');
    } catch (err) {
      console.warn('[call] camera switch failed', err);
      flashError('Could not switch camera.');
    }
  }, [replaceOutboundVideo, flashError]);

  const screenSharing = screenStream !== null;

  return {
    phase,
    error,
    localStream,
    screenStream,
    remotes,
    micEnabled,
    cameraEnabled,
    screenSharing,
    // Switching while sharing a screen would swap a camera nobody is watching.
    canSwitchCamera: kind === 'video' && cameraCount > 1 && !screenSharing,
    canShareScreen: typeof navigator !== 'undefined'
      ? typeof navigator.mediaDevices?.getDisplayMedia === 'function'
      : false,
    facingMode,
    toggleMic,
    toggleCamera,
    toggleScreenShare,
    switchCamera,
    hangUp,
  };
}

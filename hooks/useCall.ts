'use client';

import * as React from 'react';
import { api, errorMessage } from '@/lib/api/client';
import { describeConnectionFailure, mediaConstraints, type IceConfig } from '@/lib/calls/ice';
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
}

export interface UseCallResult {
  phase: CallPhase;
  error: string | null;
  localStream: MediaStream | null;
  remotes: RemoteParticipant[];
  micEnabled: boolean;
  cameraEnabled: boolean;
  toggleMic: () => void;
  toggleCamera: () => void;
  hangUp: () => Promise<void>;
}

interface Peer {
  connection: RTCPeerConnection;
  stream: MediaStream;
  /** Queued until the remote description exists — ICE can arrive first. */
  pendingCandidates: RTCIceCandidateInit[];
}

/** How often to drain signalling while a call is being set up. */
const SIGNAL_POLL_MS = 700;

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

  const peersRef = React.useRef<Map<string, Peer>>(new Map());
  const localStreamRef = React.useRef<MediaStream | null>(null);
  const cursorRef = React.useRef(0);

  /* ------------------------------------------------------------ teardown -- */

  const teardown = React.useCallback(() => {
    for (const peer of peersRef.current.values()) {
      peer.connection.onicecandidate = null;
      peer.connection.ontrack = null;
      peer.connection.onconnectionstatechange = null;
      peer.connection.close();
    }
    peersRef.current.clear();

    // Releasing tracks is what actually turns the camera light off.
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;

    setLocalStream(null);
    setRemotes([]);
    cursorRef.current = 0;
  }, []);

  /* ------------------------------------------------------- signalling io -- */

  const postSignal = React.useCallback(
    async (toUserId: string, signalKind: string, payload: Record<string, unknown>) => {
      if (!callId) return;
      try {
        await api.post(`/api/v1/families/${familyId}/calls/${callId}/signals`, {
          toUserId,
          kind: signalKind,
          payload,
        });
      } catch {
        // A dropped candidate is survivable — ICE retries with the rest.
      }
    },
    [familyId, callId],
  );

  const broadcastSignal = React.useCallback(
    (signalKind: string, payload: Record<string, unknown>) => {
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

      localStreamRef.current?.getTracks().forEach((track) => {
        connection.addTrack(track, localStreamRef.current!);
      });

      connection.onicecandidate = (event) => {
        if (event.candidate) {
          void postSignal(peerId, 'ice', { candidate: event.candidate.toJSON() });
        }
      };

      connection.ontrack = (event) => {
        event.streams[0]?.getTracks().forEach((track) => stream.addTrack(track));

        setRemotes((current) => {
          const next = current.filter((r) => r.userId !== peerId);
          return [
            ...next,
            { userId: peerId, stream, connectionState: connection.connectionState, cameraEnabled: true, micEnabled: true },
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

      const peer: Peer = { connection, stream, pendingCandidates: [] };
      peersRef.current.set(peerId, peer);
      return peer;
    },
    [ice, postSignal],
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
          const camera = Boolean(signal.payload.camera);
          const mic = Boolean(signal.payload.mic);
          setRemotes((current) =>
            current.map((r) =>
              r.userId === signal.fromUserId
                ? { ...r, cameraEnabled: camera, micEnabled: mic }
                : r
            )
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

  React.useEffect(() => {
    if (!active || !callId || !ice) return;

    let cancelled = false;

    const start = async () => {
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
        setPhase('connecting');
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
  }, [active, callId, kind, ice]);

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

  const toggleMic = React.useCallback(() => {
    const micTrack = localStreamRef.current?.getAudioTracks()[0];
    const camTrack = localStreamRef.current?.getVideoTracks()[0];
    if (!micTrack) return;
    micTrack.enabled = !micTrack.enabled;
    setMicEnabled(micTrack.enabled);
    broadcastSignal('media-state', { camera: camTrack?.enabled ?? false, mic: micTrack.enabled });
  }, [broadcastSignal]);

  const toggleCamera = React.useCallback(() => {
    const micTrack = localStreamRef.current?.getAudioTracks()[0];
    const camTrack = localStreamRef.current?.getVideoTracks()[0];
    if (!camTrack) return;
    camTrack.enabled = !camTrack.enabled;
    setCameraEnabled(camTrack.enabled);
    broadcastSignal('media-state', { camera: camTrack.enabled, mic: micTrack?.enabled ?? false });
  }, [broadcastSignal]);

  return {
    phase,
    error,
    localStream,
    remotes,
    micEnabled,
    cameraEnabled,
    toggleMic,
    toggleCamera,
    hangUp,
  };
}

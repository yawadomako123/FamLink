/**
 * WebRTC ICE configuration.
 *
 * ## Why TURN matters, and what happens without it
 *
 * WebRTC connects two browsers directly. To do that each peer must discover a
 * network path to the other, which STUN handles by telling a peer its public
 * address. STUN is cheap, stateless and free — and it is enough for most home
 * broadband.
 *
 * It is *not* enough for everyone. Behind symmetric NAT, carrier-grade NAT
 * (common on mobile networks), or a restrictive corporate firewall, no direct
 * path exists and the connection simply never establishes. The usual industry
 * figure is 15–20% of connection attempts. Those calls need TURN, which relays
 * the media through a server — and a relay costs real bandwidth, which is why
 * there is no free public TURN worth depending on.
 *
 * FamLink therefore ships STUN-only by default and is explicit about it:
 * `TURN_URL` and friends are optional env vars, and the call UI says a call
 * failed because of network restrictions rather than spinning forever on
 * "Connecting…". Configure TURN before relying on calls in production.
 */

export interface IceConfig {
  iceServers: RTCIceServer[];
  /** False when only STUN is available, so the UI can set expectations. */
  hasRelay: boolean;
  /** Unix seconds; present when credentials are time-limited. */
  relayExpiresAt?: number;
}

/**
 * Public STUN servers.
 *
 * Several, because a single unreachable STUN server delays connection while
 * ICE times out. These only reveal a public IP to the STUN host; no media or
 * FamLink data passes through them.
 */
const PUBLIC_STUN: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

export function buildIceConfig(turn?: {
  urls: string[];
  username: string;
  credential: string;
  expiresAt: number;
} | null): IceConfig {
  const iceServers = [...PUBLIC_STUN];

  if (turn && turn.urls.length > 0) {
    /*
     * One entry carrying every transport, so ICE tries UDP first and falls
     * back to TCP/TLS on the same credentials. TLS on 443 is what gets through
     * firewalls that block everything else.
     */
    iceServers.push({
      urls: turn.urls,
      ...(turn.username ? { username: turn.username } : {}),
      ...(turn.credential ? { credential: turn.credential } : {}),
    });
  }

  return {
    iceServers,
    hasRelay: Boolean(turn && turn.urls.length > 0),
    ...(turn ? { relayExpiresAt: turn.expiresAt } : {}),
  };
}

/**
 * Mesh participant cap.
 *
 * Every participant holds a peer connection to every other, so upload cost
 * grows with (n-1). Four people is about the limit before a typical phone's
 * uplink and CPU start dropping frames. Beyond this an SFU is required, which
 * is a server component well outside an MVP — so the cap is enforced and
 * explained rather than silently producing a bad call.
 */
export const MAX_CALL_PARTICIPANTS = 4;

/** Constraints per call kind. Audio is always requested; video only for video. */
export function mediaConstraints(kind: 'audio' | 'video'): MediaStreamConstraints {
  return {
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video:
      kind === 'video'
        ? {
            // A modest target: family calls are usually on mobile data, and a
            // reliable 640x480 beats a stuttering 1080p.
            width: { ideal: 1280, max: 1920 },
            height: { ideal: 720, max: 1080 },
            frameRate: { ideal: 24, max: 30 },
            facingMode: 'user',
          }
        : false,
  };
}

/** Human-readable explanation for a failed connection. */
export function describeConnectionFailure(hasRelay: boolean): string {
  return hasRelay
    ? 'The call could not connect. This is usually a temporary network problem — try again.'
    : "The call couldn't connect. Some networks (mobile data and office Wi-Fi especially) block direct connections between devices, and this FamLink deployment has no relay server configured to work around it.";
}

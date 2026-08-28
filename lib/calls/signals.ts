import { z } from 'zod';

/**
 * The signalling vocabulary, shared by both ends of the relay.
 *
 * This list exists as one constant rather than as a literal in the route and
 * another in the client because they drifted once already: the client began
 * sending `media-state` and the route's schema still listed four kinds, so
 * every mute was rejected with a 400 that the client swallowed. Muting worked
 * locally and nobody else was ever told.
 *
 * Typing the client's sender against this list makes that drift a compile
 * error instead of a silent one.
 */
export const SIGNAL_KINDS = [
  'offer',
  'answer',
  'ice',
  'renegotiate',
  /** Mic, camera and screen-share flags. Not SDP, but ordered alongside it. */
  'media-state',
] as const;

export type SignalKind = (typeof SIGNAL_KINDS)[number];

/**
 * The body the signalling route accepts.
 *
 * Defined here, beside the vocabulary, so it can be tested without standing up
 * a route handler and a session. The bug this guards against was never in the
 * service — `sendSignal` accepted any kind — but in this validation, and the
 * service-level tests sail straight past it.
 */
export const signalBodySchema = z.object({
  toUserId: z.string().min(1).optional(),
  kind: z.enum(SIGNAL_KINDS),
  // SDP and ICE candidates are opaque to us; the browser validates them.
  payload: z.record(z.string(), z.unknown()),
});

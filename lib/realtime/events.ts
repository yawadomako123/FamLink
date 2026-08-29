/**
 * Realtime event contract.
 *
 * A deliberate design choice runs through this file: **events carry
 * invalidation hints, never payloads.**
 *
 * Postgres `NOTIFY` is a broadcast — every listener on the channel receives
 * every message. If a location update carried coordinates, those coordinates
 * would travel to a process that must then be trusted to filter them
 * correctly for each viewer. One bug there leaks a position to somebody who
 * set their visibility to nobody.
 *
 * Instead an event says only *that* something changed in a family. The client
 * re-fetches through the ordinary authorized endpoint, so the location
 * visibility rule is applied on every read, by the same code path as a page
 * load. The cost is one extra round trip; the benefit is that the realtime
 * layer cannot become a second, weaker authorization surface.
 *
 * The one exception is `emergency`, which carries the triggering member's name
 * so an SOS can be shown instantly. That is not sensitive in the way a
 * location is: everyone in the family is entitled to know an SOS was raised.
 */

export const REALTIME_CHANNEL = 'famlink_events';

export type RealtimeEventType =
  | 'locations'
  | 'message'
  | 'notification'
  | 'emergency'
  | 'members'
  /**
   * A call changed: someone started, joined, left one, or sent a signalling
   * message. Like every other event this carries no payload — the client
   * fetches the call state and any signals addressed to it.
   */
  | 'call'
  /**
   * Somebody is composing a message.
   *
   * Purely ephemeral — nothing is stored, and a missed one costs nothing but a
   * missing indicator for a couple of seconds.
   */
  | 'typing';

export interface RealtimeEvent {
  /** Which family the change belongs to. Used for server-side filtering. */
  familyId: string;
  type: RealtimeEventType;
  /** Emitted at, as epoch milliseconds. Used to drop stale replays. */
  at: number;
  /**
   * Populated for `emergency` and `typing`. Never contains coordinates.
   */
  actorName?: string;
  /**
   * Who caused the event. Only sent for `typing`, where the client needs it to
   * recognise and ignore its own keystrokes.
   *
   * A user id is not sensitive within a family — everyone on this channel is
   * already a member and can see the whole member list. It carries nothing
   * about where anybody is, which is the line this file draws.
   */
  actorId?: string;
}

/** Postgres caps a NOTIFY payload at 8000 bytes; hints are far below that. */
export const MAX_PAYLOAD_BYTES = 7_000;

export function isRealtimeEvent(value: unknown): value is RealtimeEvent {
  if (typeof value !== 'object' || value === null) return false;

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.familyId === 'string' &&
    typeof candidate.type === 'string' &&
    typeof candidate.at === 'number'
  );
}

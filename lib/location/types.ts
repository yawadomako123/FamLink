/**
 * Location shapes shared between server and client.
 *
 * Kept out of `service.ts` because that module is `server-only`; a client
 * component importing a type from it would drag the server guard into the
 * bundle.
 *
 * Note the date handling: the service works in `Date`, but JSON has no date
 * type, so anything that has crossed the wire carries an ISO string. The two
 * names below keep that distinction visible rather than papering over it with
 * a cast at the boundary.
 */

export type WithheldReason = 'not-sharing' | 'paused' | 'hidden' | 'no-fix';

export interface WithheldMember {
  userId: string;
  reason: WithheldReason;
}

/** As returned by the API and consumed by client components. */
export interface MemberLocation {
  userId: string;
  name: string;
  image: string | null;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  /** ISO 8601 — this value has been through JSON. */
  recordedAt: string;
  batteryPercentage: number | null;
  isCharging: boolean | null;
}

export interface FamilyLocationsResponse {
  locations: MemberLocation[];
  withheld: WithheldMember[];
}

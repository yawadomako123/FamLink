import 'server-only';

import { createHmac } from 'node:crypto';
import { serverEnv } from '@/lib/env';

/**
 * TURN credentials.
 *
 * ## Why these are generated rather than configured
 *
 * A browser cannot use a TURN relay without holding its credentials, which
 * means the credentials necessarily reach the client. Shipping a static
 * username and password therefore hands every visitor a permanent key to your
 * relay — and relay bandwidth is the expensive part, so a leaked static
 * credential is somebody else's traffic on your bill, indefinitely.
 *
 * The standard answer is the TURN REST API scheme that coturn, Cloudflare,
 * Twilio and every other implementation support:
 *
 *   username   = <expiry-unix-timestamp>:<user-id>
 *   credential = base64(HMAC-SHA1(shared-secret, username))
 *
 * The relay recomputes the HMAC from a secret it shares with us, so no
 * credential list is stored anywhere and every issued credential expires. The
 * shared secret never leaves the server.
 *
 * `TURN_STATIC_AUTH_SECRET` selects this mode. `TURN_USERNAME` /
 * `TURN_CREDENTIAL` remain supported for hosted providers that issue
 * long-lived credentials themselves.
 */

/**
 * How long an issued credential stays valid.
 *
 * Long enough to cover a call that is set up and then runs for a while —
 * credentials are only checked at allocation time, so an in-progress call is
 * not cut off when they expire — and short enough that a leaked one is close
 * to worthless.
 */
const CREDENTIAL_TTL_SECONDS = 6 * 60 * 60;

export interface TurnCredentials {
  urls: string[];
  username: string;
  credential: string;
  /** Unix seconds. Exposed so the client can refresh before expiry. */
  expiresAt: number;
}

/**
 * Issues short-lived TURN credentials for one user.
 *
 * Returns null when no relay is configured, which the caller reports honestly
 * rather than pretending calls will always connect.
 */
export function issueTurnCredentials(userId: string): TurnCredentials | null {
  const env = serverEnv();

  if (!env.TURN_URL) return null;

  // Several transports: UDP is best, but TCP and TLS on 443 get through
  // firewalls that block everything else, which is often the whole point.
  const urls = env.TURN_URLS
    ? env.TURN_URLS.split(',').map((u) => u.trim()).filter(Boolean)
    : [env.TURN_URL];

  const expiresAt = Math.floor(Date.now() / 1000) + CREDENTIAL_TTL_SECONDS;

  if (env.TURN_STATIC_AUTH_SECRET) {
    /*
     * Ephemeral mode. The username carries its own expiry, so the relay can
     * validate and expire it without storing anything.
     */
    const username = `${expiresAt}:${userId}`;
    const credential = createHmac('sha1', env.TURN_STATIC_AUTH_SECRET)
      .update(username)
      .digest('base64');

    return { urls, username, credential, expiresAt };
  }

  // Static mode, for hosted providers that issue their own credentials.
  if (env.TURN_USERNAME && env.TURN_CREDENTIAL) {
    return {
      urls,
      username: env.TURN_USERNAME,
      credential: env.TURN_CREDENTIAL,
      expiresAt,
    };
  }

  /*
   * A URL with no credentials at all. Some relays allow anonymous access;
   * most do not, and this will simply fail to allocate. Returned anyway so the
   * failure is visible in the diagnostic rather than silently absent.
   */
  return { urls, username: '', credential: '', expiresAt };
}

/** Whether a relay is configured at all, and in which mode. */
export function turnMode(): 'ephemeral' | 'static' | 'none' {
  const env = serverEnv();

  if (!env.TURN_URL) return 'none';
  if (env.TURN_STATIC_AUTH_SECRET) return 'ephemeral';
  return 'static';
}

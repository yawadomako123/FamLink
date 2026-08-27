import 'server-only';

import { Errors } from './errors';

/**
 * Fixed-window rate limiting.
 *
 * This is an in-process limiter. On a single instance it is exact; across
 * several serverless instances each keeps its own window, so the effective
 * limit is (limit x instances). That is an acceptable trade for the MVP —
 * the goal here is to stop a runaway client or a naive scripted abuse of the
 * location endpoint, not to enforce a billing quota.
 *
 * Moving to a shared store (Upstash Redis, or Postgres if a round trip is
 * affordable) is a drop-in replacement for `hit()` — see the README.
 */

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

/** Bound the map so a flood of distinct keys cannot exhaust memory. */
const MAX_TRACKED_KEYS = 10_000;

function sweep(now: number): void {
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
}

export interface RateLimitRule {
  /** Requests permitted per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

/**
 * Tuned per endpoint. The location rule is the loose one by necessity: a
 * moving device legitimately reports often, and the client already throttles
 * by distance and time before sending.
 */
export const RATE_LIMITS = {
  locationUpdate: { limit: 120, windowMs: 60_000 },
  message: { limit: 30, windowMs: 60_000 },
  sos: { limit: 5, windowMs: 60_000 },
  invitation: { limit: 20, windowMs: 60 * 60_000 },
  mutation: { limit: 60, windowMs: 60_000 },
} as const satisfies Record<string, RateLimitRule>;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function hit(key: string, rule: RateLimitRule, now: number = Date.now()): RateLimitResult {
  if (windows.size > MAX_TRACKED_KEYS) sweep(now);

  const existing = windows.get(key);

  if (!existing || existing.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + rule.windowMs });
    return { allowed: true, remaining: rule.limit - 1, retryAfterSeconds: 0 };
  }

  existing.count += 1;

  if (existing.count > rule.limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  return {
    allowed: true,
    remaining: rule.limit - existing.count,
    retryAfterSeconds: 0,
  };
}

/** Throwing form used by route handlers. */
export function enforceRateLimit(
  scope: keyof typeof RATE_LIMITS,
  identifier: string,
  now?: number,
): void {
  const result = hit(`${scope}:${identifier}`, RATE_LIMITS[scope], now);
  if (!result.allowed) throw Errors.rateLimited(result.retryAfterSeconds);
}

/** Test seam. */
export function __resetRateLimits(): void {
  windows.clear();
}

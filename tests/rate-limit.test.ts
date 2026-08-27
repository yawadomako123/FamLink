import { beforeEach, describe, expect, it } from 'vitest';
import { hit, enforceRateLimit, __resetRateLimits, RATE_LIMITS } from '@/lib/api/rate-limit';
import { ApiError } from '@/lib/api/errors';

describe('rate limiting', () => {
  beforeEach(() => {
    __resetRateLimits();
  });

  it('allows requests up to the limit', () => {
    const rule = { limit: 3, windowMs: 1000 };

    expect(hit('k', rule, 0).allowed).toBe(true);
    expect(hit('k', rule, 0).allowed).toBe(true);
    expect(hit('k', rule, 0).allowed).toBe(true);
  });

  it('refuses the request that exceeds the limit', () => {
    const rule = { limit: 2, windowMs: 1000 };

    hit('k', rule, 0);
    hit('k', rule, 0);
    const third = hit('k', rule, 0);

    expect(third.allowed).toBe(false);
    expect(third.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('starts a fresh window once the old one lapses', () => {
    const rule = { limit: 1, windowMs: 1000 };

    expect(hit('k', rule, 0).allowed).toBe(true);
    expect(hit('k', rule, 500).allowed).toBe(false);
    expect(hit('k', rule, 1001).allowed).toBe(true);
  });

  it('keeps separate budgets per key', () => {
    const rule = { limit: 1, windowMs: 1000 };

    expect(hit('user-a', rule, 0).allowed).toBe(true);
    // One user exhausting their budget must not affect anyone else.
    expect(hit('user-b', rule, 0).allowed).toBe(true);
    expect(hit('user-a', rule, 0).allowed).toBe(false);
  });

  it('reports remaining budget accurately', () => {
    const rule = { limit: 3, windowMs: 1000 };

    expect(hit('k', rule, 0).remaining).toBe(2);
    expect(hit('k', rule, 0).remaining).toBe(1);
    expect(hit('k', rule, 0).remaining).toBe(0);
  });

  it('throws a 429 ApiError from the enforcing wrapper', () => {
    const identifier = 'user-1';

    for (let i = 0; i < RATE_LIMITS.sos.limit; i += 1) {
      enforceRateLimit('sos', identifier);
    }

    try {
      enforceRateLimit('sos', identifier);
      expect.unreachable('expected the SOS rate limit to be enforced');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(429);
    }
  });

  it('scopes limits by endpoint, so chat cannot exhaust the SOS budget', () => {
    const identifier = 'user-1';

    for (let i = 0; i < RATE_LIMITS.message.limit; i += 1) {
      enforceRateLimit('message', identifier);
    }

    // An SOS must still get through after a chatty session.
    expect(() => enforceRateLimit('sos', identifier)).not.toThrow();
  });
});

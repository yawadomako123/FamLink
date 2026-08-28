import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * TURN credentials.
 *
 * Untested until now, and the least visible thing in the app when it goes
 * wrong: bad credentials do not throw, they just mean the relay refuses the
 * allocation and roughly one call in five never connects — on mobile data
 * especially. The failure looks like "calls are flaky", not like a bug.
 *
 * `lib/env` caches its parse, and `lib/calls/turn` reads it at call time, so
 * each case re-imports both with the environment it wants.
 */

const ORIGINAL = { ...process.env };

const TURN_KEYS = [
  'TURN_URL',
  'TURN_URLS',
  'TURN_STATIC_AUTH_SECRET',
  'TURN_USERNAME',
  'TURN_CREDENTIAL',
] as const;

async function loadTurn(env: Partial<Record<(typeof TURN_KEYS)[number], string>>) {
  for (const key of TURN_KEYS) delete process.env[key];
  Object.assign(process.env, env);

  // Drop the module registry so `lib/env`'s cached parse is rebuilt against
  // the environment this case just set.
  vi.resetModules();

  return import('@/lib/calls/turn');
}

beforeEach(() => {
  process.env = { ...ORIGINAL };
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe('no relay configured', () => {
  it('issues nothing when TURN_URL is absent', async () => {
    const { issueTurnCredentials, turnMode } = await loadTurn({});

    expect(issueTurnCredentials('user-1')).toBeNull();
    expect(turnMode()).toBe('none');
  });
});

describe('static credentials', () => {
  const env = {
    TURN_URL: 'turn:relay.example:3478',
    TURN_USERNAME: 'account-id',
    TURN_CREDENTIAL: 'account-secret',
  };

  it('passes the provider’s own credentials through unchanged', async () => {
    const { issueTurnCredentials, turnMode } = await loadTurn(env);
    const issued = issueTurnCredentials('user-1');

    expect(turnMode()).toBe('static');
    expect(issued?.username).toBe('account-id');
    expect(issued?.credential).toBe('account-secret');
  });

  /*
   * The deployment this was written against has TURN_STATIC_AUTH_SECRET="" in
   * its environment alongside static credentials. An empty string must not be
   * mistaken for a configured secret — that would generate an HMAC the
   * provider cannot verify, and silently break every relayed call.
   */
  it('treats an empty shared secret as absent, not as ephemeral mode', async () => {
    const { issueTurnCredentials, turnMode } = await loadTurn({
      ...env,
      TURN_STATIC_AUTH_SECRET: '',
    });

    expect(turnMode()).toBe('static');
    expect(issueTurnCredentials('user-1')?.username).toBe('account-id');
  });
});

describe('ephemeral credentials', () => {
  const secret = 'shared-secret-value';
  const env = { TURN_URL: 'turn:relay.example:3478', TURN_STATIC_AUTH_SECRET: secret };

  it('builds a username of expiry:userId', async () => {
    const { issueTurnCredentials } = await loadTurn(env);
    const issued = issueTurnCredentials('user-1');

    const [expiry, userId] = issued!.username.split(':');
    expect(userId).toBe('user-1');
    expect(Number(expiry)).toBe(issued!.expiresAt);
    expect(issued!.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  /*
   * The relay recomputes this exact HMAC from the shared secret. If the digest
   * or encoding drifts, every allocation is refused.
   */
  it('signs the username with HMAC-SHA1, base64', async () => {
    const { issueTurnCredentials } = await loadTurn(env);
    const issued = issueTurnCredentials('user-1');

    const expected = createHmac('sha1', secret).update(issued!.username).digest('base64');
    expect(issued!.credential).toBe(expected);
  });

  it('prefers the shared secret over static credentials when both are set', async () => {
    const { issueTurnCredentials, turnMode } = await loadTurn({
      ...env,
      TURN_USERNAME: 'account-id',
      TURN_CREDENTIAL: 'account-secret',
    });

    expect(turnMode()).toBe('ephemeral');
    expect(issueTurnCredentials('user-1')?.username).not.toBe('account-id');
  });

  it('gives different users different credentials', async () => {
    const { issueTurnCredentials } = await loadTurn(env);

    expect(issueTurnCredentials('user-1')?.credential).not.toBe(
      issueTurnCredentials('user-2')?.credential,
    );
  });
});

describe('transports', () => {
  it('splits TURN_URLS into one entry per transport', async () => {
    const { issueTurnCredentials } = await loadTurn({
      TURN_URL: 'turn:relay.example:3478',
      TURN_URLS: 'turn:relay.example:3478?transport=udp, turn:relay.example:3478?transport=tcp',
      TURN_USERNAME: 'u',
      TURN_CREDENTIAL: 'c',
    });

    expect(issueTurnCredentials('user-1')?.urls).toEqual([
      'turn:relay.example:3478?transport=udp',
      'turn:relay.example:3478?transport=tcp',
    ]);
  });

  it('falls back to the single URL when no list is given', async () => {
    const { issueTurnCredentials } = await loadTurn({
      TURN_URL: 'turn:relay.example:3478',
      TURN_USERNAME: 'u',
      TURN_CREDENTIAL: 'c',
    });

    expect(issueTurnCredentials('user-1')?.urls).toEqual(['turn:relay.example:3478']);
  });
});

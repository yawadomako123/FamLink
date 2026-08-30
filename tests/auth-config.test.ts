import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Optional-provider configuration.
 *
 * Google sign-in needs both halves of its credentials. Half-configured is the
 * dangerous state: the button appears, sends somebody to Google, and fails on
 * the way back — after they have already approved something. The gate exists
 * so that state renders no button at all.
 */

const ORIGINAL = { ...process.env };

async function loadEnv(vars: Record<string, string | undefined>) {
  for (const key of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']) delete process.env[key];
  Object.assign(process.env, vars);
  vi.resetModules();
  return import('@/lib/env');
}

beforeEach(() => {
  process.env = { ...ORIGINAL };
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe('google sign-in gate', () => {
  it('is on when both halves are present', async () => {
    const { isGoogleAuthEnabled } = await loadEnv({
      GOOGLE_CLIENT_ID: 'id.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: 'secret',
    });

    expect(isGoogleAuthEnabled()).toBe(true);
  });

  it('is off with only a client id', async () => {
    const { isGoogleAuthEnabled } = await loadEnv({
      GOOGLE_CLIENT_ID: 'id.apps.googleusercontent.com',
    });

    expect(isGoogleAuthEnabled(), 'a button that cannot complete must not appear').toBe(false);
  });

  it('is off with only a secret', async () => {
    const { isGoogleAuthEnabled } = await loadEnv({ GOOGLE_CLIENT_SECRET: 'secret' });

    expect(isGoogleAuthEnabled()).toBe(false);
  });

  it('is off when neither is set', async () => {
    const { isGoogleAuthEnabled } = await loadEnv({});

    expect(isGoogleAuthEnabled()).toBe(false);
  });

  /* An empty string in the environment is not a credential. */
  it('treats empty strings as absent', async () => {
    const { isGoogleAuthEnabled } = await loadEnv({
      GOOGLE_CLIENT_ID: '',
      GOOGLE_CLIENT_SECRET: '',
    });

    expect(isGoogleAuthEnabled()).toBe(false);
  });
});

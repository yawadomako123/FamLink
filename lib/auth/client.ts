'use client';

import { createAuthClient } from 'better-auth/react';

/**
 * Browser-side auth client. Talks to /api/auth/* on the same origin, so no
 * base URL is needed and no secret ever reaches the bundle.
 *
 * Methods are re-exported as wrappers rather than destructured: the client is
 * a Proxy whose members are resolved through conditional types, and pulling
 * them off the object eagerly does not always typecheck.
 */
export const authClient = createAuthClient();

export const signIn = authClient.signIn;
export const signUp = authClient.signUp;
export const useSession = authClient.useSession;

export function signOut(): ReturnType<typeof authClient.signOut> {
  return authClient.signOut();
}

/** Sends the "choose a new password" email. */
export function requestPasswordReset(input: { email: string; redirectTo: string }) {
  return authClient.requestPasswordReset(input);
}

/** Completes a reset using the token from the emailed link. */
export function resetPassword(input: { newPassword: string; token: string }) {
  return authClient.resetPassword(input);
}

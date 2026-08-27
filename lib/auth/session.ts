import 'server-only';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth, type Session } from './index';

/**
 * Resolves the caller's session from the incoming request.
 *
 * Works for both client kinds by design: the PWA sends the session cookie, a
 * future native client sends `Authorization: Bearer <token>`. Better Auth's
 * bearer plugin accepts either, so nothing downstream needs to know which.
 *
 * Returns null when unauthenticated — callers decide whether that is an error.
 */
export async function getSession(): Promise<Session | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  return session ?? null;
}

/**
 * For server components and pages: sends unauthenticated visitors to login,
 * preserving where they were headed.
 */
export async function requireSession(returnTo?: string): Promise<Session> {
  const session = await getSession();

  if (!session) {
    const target = returnTo ? `/login?next=${encodeURIComponent(returnTo)}` : '/login';
    redirect(target);
  }

  return session;
}

/** Convenience wrapper when only the user is needed. */
export async function requireUser(returnTo?: string) {
  const session = await requireSession(returnTo);
  return session.user;
}

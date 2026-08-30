import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { isGoogleAuthEnabled } from '@/lib/env';
import { Alert } from '@/components/ui/feedback';
import { AuthDivider, GoogleButton } from '../google-button';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Log in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    next?: string;
    registered?: string;
    authError?: string;
    /** Better Auth appends its own reason alongside ours. */
    error?: string;
  }>;
}) {
  // Already signed in? Skip the form entirely.
  if (await getSession()) redirect('/dashboard');

  const params = await searchParams;
  const nextPath = safeNext(params.next);

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
      <p className="text-sm text-muted mt-1.5">Log in to see how your family is doing.</p>

      {/*
        Google sent them back without a session.

        The reason is named rather than guessed at. The first version of this
        offered two plausible causes and neither was the real one, which cost a
        round of "it still doesn't work" — the actual reason was sitting in the
        query string the whole time.
      */}
      {params.authError === 'google' && (
        <Alert tone="error" title="Google sign-in didn’t complete" className="mt-5">
          {describeGoogleFailure(params.error)}
        </Alert>
      )}

      {/*
        Above the password form, because it is the shorter road for anybody it
        suits, and because somebody who signed up with Google has no password
        to be reminded of.
      */}
      {isGoogleAuthEnabled() && (
        <>
          <GoogleButton callbackURL={nextPath} className="mt-7" />
          <AuthDivider>or log in with email</AuthDivider>
        </>
      )}

      <LoginForm
        nextPath={nextPath}
        justRegistered={params.registered === '1'}
        className={isGoogleAuthEnabled() ? undefined : 'mt-7'}
      />

      <p className="text-sm text-muted text-center mt-6">
        New to FamLink?{' '}
        <Link href="/register" className="font-medium text-brand-700 hover:underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}

/**
 * Turns Better Auth's reason into something a person can act on.
 *
 * The unrecognised case still shows the raw code. It is meaningless to most
 * people, but it is the difference between a bug report that can be diagnosed
 * and one that cannot — and this failure has already cost two rounds of
 * guessing for want of exactly that.
 */
function describeGoogleFailure(code: string | undefined): string {
  switch (code) {
    case 'account_not_linked':
      return 'An account already exists for that email address. Log in with your email and password instead — you can use Google next time.';
    case 'state_mismatch':
    case 'state_not_found':
      return 'The sign-in took too long, or it started in one browser and finished in another. Please try again.';
    case 'invalid_code':
      return 'Google’s reply could not be verified. Please try again.';
    case 'access_denied':
      return 'You cancelled at the Google screen, or Google declined the request.';
    case undefined:
    case '':
      return 'You were sent back before signing in finished. Please try again, or use your email and password.';
    default:
      return `Google sent you back with: ${code}. Please try again, or use your email and password.`;
  }
}

/**
 * Only ever redirect within this app. An absolute or protocol-relative URL in
 * `next` would turn the login page into an open redirect.
 */
function safeNext(next: string | undefined): string {
  if (!next) return '/dashboard';
  if (!next.startsWith('/') || next.startsWith('//')) return '/dashboard';
  return next;
}

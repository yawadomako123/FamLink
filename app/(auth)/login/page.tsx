import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { isGoogleAuthEnabled } from '@/lib/env';
import { AuthDivider, GoogleButton } from '../google-button';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Log in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; registered?: string }>;
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
 * Only ever redirect within this app. An absolute or protocol-relative URL in
 * `next` would turn the login page into an open redirect.
 */
function safeNext(next: string | undefined): string {
  if (!next) return '/dashboard';
  if (!next.startsWith('/') || next.startsWith('//')) return '/dashboard';
  return next;
}

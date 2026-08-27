import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
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

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
      <p className="text-sm text-muted mt-1.5">Log in to see how your family is doing.</p>

      <LoginForm
        nextPath={safeNext(params.next)}
        justRegistered={params.registered === '1'}
        className="mt-7"
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

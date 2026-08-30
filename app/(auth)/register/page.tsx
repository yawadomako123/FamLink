import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { isGoogleAuthEnabled } from '@/lib/env';
import { AuthDivider, GoogleButton } from '../google-button';
import { RegisterForm } from './register-form';

export const metadata: Metadata = { title: 'Create your account' };

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  if (await getSession()) redirect('/dashboard');

  const params = await searchParams;
  // Arriving from an invitation link: send them straight back to it afterwards.
  const inviteCode = params.invite?.trim().toUpperCase();

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
      <p className="text-sm text-muted mt-1.5">
        {inviteCode
          ? 'Set up your account, then you can join the family you were invited to.'
          : 'Start a private space for your family in under a minute.'}
      </p>

      {/*
        The invitation has to survive the round trip to Google, so the
        callback returns to the join page rather than the dashboard —
        otherwise somebody who signed up from an invite link would land in an
        empty account with no sign of the family that invited them.
      */}
      {isGoogleAuthEnabled() && (
        <>
          <GoogleButton
            callbackURL={inviteCode ? `/join/${inviteCode}` : '/dashboard'}
            label="Sign up with Google"
            className="mt-7"
          />
          <AuthDivider>or sign up with email</AuthDivider>
        </>
      )}

      <RegisterForm
        inviteCode={inviteCode}
        className={isGoogleAuthEnabled() ? undefined : 'mt-7'}
      />

      <p className="text-sm text-muted text-center mt-6">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-brand-700 hover:underline">
          Log in
        </Link>
      </p>
    </div>
  );
}

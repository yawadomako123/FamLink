import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Users } from 'lucide-react';
import { Logo } from '@/components/layout/logo';
import { Alert } from '@/components/ui/feedback';
import { Button } from '@/components/ui/button';
import { getSession } from '@/lib/auth/session';
import { previewInvitation } from '@/lib/families/service';
import { invitationCodeSchema } from '@/lib/validation/family';
import { ApiError } from '@/lib/api/errors';
import { AcceptInvitation } from './accept-invitation';

export const metadata: Metadata = { title: 'Join a family' };

/**
 * The destination of an invitation link.
 *
 * Requires sign-in first: an anonymous preview would let anyone brute-force
 * codes to discover family names. Someone arriving without an account is sent
 * to register with the code preserved, so they land back here afterwards.
 */
export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code: rawCode } = await params;

  const parsed = invitationCodeSchema.safeParse(rawCode);
  if (!parsed.success) return <JoinShell>{<InvalidLink />}</JoinShell>;

  const code = parsed.data;
  const session = await getSession();

  if (!session) {
    redirect(`/register?invite=${encodeURIComponent(code)}`);
  }

  let preview: Awaited<ReturnType<typeof previewInvitation>>;

  try {
    preview = await previewInvitation(session.user.id, code);
  } catch (error) {
    return (
      <JoinShell>
        <InvitationProblem
          message={
            error instanceof ApiError
              ? error.message
              : 'We could not open this invitation. Please ask for a new link.'
          }
        />
      </JoinShell>
    );
  }

  if (preview.alreadyMember) {
    return (
      <JoinShell>
        <div className="text-center">
          <h1 className="text-xl font-semibold tracking-tight">
            You&rsquo;re already in {preview.familyName}
          </h1>
          <p className="text-sm text-muted mt-2">Nothing more to do — head to your dashboard.</p>
          <Link href="/dashboard" className="block mt-6">
            <Button size="lg" fullWidth>
              Go to FamLink
            </Button>
          </Link>
        </div>
      </JoinShell>
    );
  }

  return (
    <JoinShell>
      <div className="text-center">
        <div className="size-14 rounded-2xl bg-tint-brand flex items-center justify-center mx-auto">
          <Users aria-hidden className="size-7 text-brand-600" />
        </div>

        <p className="text-sm text-muted mt-5">
          {preview.invitedByName} invited you to join
        </p>
        <h1 className="text-2xl font-semibold tracking-tight mt-1">{preview.familyName}</h1>
        <p className="text-sm text-muted mt-2">
          {preview.memberCount} {preview.memberCount === 1 ? 'member' : 'members'} · you&rsquo;ll
          join as a {preview.role}
        </p>
      </div>

      <AcceptInvitation code={code} familyName={preview.familyName} className="mt-8" />

      <p className="text-xs text-muted text-center mt-6 leading-relaxed">
        Joining does not share your location. Sharing stays off until you turn it on yourself.
      </p>
    </JoinShell>
  );
}

function JoinShell({ children }: { children: React.ReactNode }) {
  return (
    <main
      id="main"
      className="min-h-dvh flex flex-col justify-center px-5 py-10 bg-surface"
    >
      <div className="w-full max-w-sm mx-auto">
        <div className="flex justify-center mb-10">
          <Logo />
        </div>
        {children}
      </div>
    </main>
  );
}

function InvalidLink() {
  return (
    <InvitationProblem message="That invitation link doesn't look right. Check you copied all of it, or ask for a new one." />
  );
}

function InvitationProblem({ message }: { message: string }) {
  return (
    <div>
      <Alert tone="error" title="This invitation can't be used">
        {message}
      </Alert>
      <Link href="/dashboard" className="block mt-6">
        <Button variant="secondary" size="lg" fullWidth>
          Go to FamLink
        </Button>
      </Link>
    </div>
  );
}

'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { authClient } from '@/lib/auth/client';
import { Alert } from '@/components/ui/feedback';
import { cn } from '@/lib/utils';

/**
 * "Continue with Google", for both signing in and signing up.
 *
 * One button for both, because to Google they are the same act: it returns an
 * identity, and whether FamLink has seen it before is FamLink's business, not
 * something to ask about beforehand. Account linking is configured so an
 * address that already has a password account attaches to it rather than
 * quietly creating a second one.
 *
 * Rendered only where the server said the provider is configured — a button
 * that sends somebody to Google and fails on the way back is worse than no
 * button, because by then they have already approved something.
 */
export function GoogleButton({
  /** Where to land after Google returns. Carries the invite through. */
  callbackURL,
  label = 'Continue with Google',
  className,
}: {
  callbackURL: string;
  label?: string;
  className?: string;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);

    try {
      const { error: failed } = await authClient.signIn.social({
        provider: 'google',
        callbackURL,
        /*
         * Where Google sends somebody when the round trip fails.
         *
         * Without this they land on better-auth's own `/api/auth/error` page:
         * unstyled, outside the app, and wearing a message like
         * `state_not_found`. It reads as being silently signed out, which is
         * how this was first reported.
         */
        errorCallbackURL: '/login?authError=google',
      });

      if (failed) {
        setError('Could not start Google sign-in. Please try again.');
        setBusy(false);
      }
      // On success the browser leaves for Google, so `busy` stays true and the
      // button keeps its spinner until the page is replaced.
    } catch {
      setError('Could not reach Google. Check your connection and try again.');
      setBusy(false);
    }
  }

  return (
    <div className={className}>
      {error && (
        <Alert tone="error" className="mb-3">
          {error}
        </Alert>
      )}

      <button
        type="button"
        onClick={() => void start()}
        disabled={busy}
        className={cn(
          'w-full h-13 rounded-xl inline-flex items-center justify-center gap-3',
          'bg-card border border-line-strong text-fg font-medium',
          'transition-colors hover:bg-raised active:bg-inset',
          'disabled:opacity-55 disabled:cursor-not-allowed',
        )}
      >
        {busy ? (
          <Loader2 aria-hidden className="size-5 animate-spin" />
        ) : (
          <GoogleMark />
        )}
        {label}
      </button>
    </div>
  );
}

/**
 * Google's mark, inline.
 *
 * Drawn here rather than fetched: Google's brand guidelines require the four
 * colours be kept exactly, and an icon that fails to load would leave a button
 * that looks like it belongs to nobody.
 */
function GoogleMark() {
  return (
    <svg aria-hidden viewBox="0 0 18 18" className="size-5 shrink-0">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.41 5.41 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}

/** A labelled rule, for putting Google above the password form. */
export function AuthDivider({ children = 'or' }: { children?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 my-5">
      <span className="h-px flex-1 bg-line" />
      <span className="text-xs text-subtle">{children}</span>
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

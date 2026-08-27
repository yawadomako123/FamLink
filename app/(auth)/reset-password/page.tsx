'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/feedback';
import { resetPassword } from '@/lib/auth/client';
import { fieldErrors, resetPasswordSchema } from '@/lib/validation/auth';

export default function ResetPasswordPage() {
  return (
    // useSearchParams needs a Suspense boundary during prerendering.
    <React.Suspense fallback={<ResetSkeleton />}>
      <ResetPasswordForm />
    </React.Suspense>
  );
}

function ResetSkeleton() {
  return (
    <div className="space-y-4">
      <div className="skeleton h-7 w-52 rounded-lg" />
      <div className="skeleton h-11 w-full rounded-xl" />
      <div className="skeleton h-12 w-full rounded-xl" />
    </div>
  );
}

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const linkError = searchParams.get('error');

  const [submitting, setSubmitting] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [showPassword, setShowPassword] = React.useState(false);

  // Better Auth appends ?error=INVALID_TOKEN when the link is bad or expired.
  if (!token || linkError) {
    return (
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">This link has expired</h1>
        <p className="text-sm text-muted mt-2 leading-relaxed">
          Password reset links are valid for one hour and can be used once. Request a fresh one
          to continue.
        </p>
        <Link href="/forgot-password" className="block mt-6">
          <Button size="lg" fullWidth>
            Request a new link
          </Button>
        </Link>
        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg transition-colors mt-6"
        >
          <ArrowLeft aria-hidden className="size-4" />
          Back to log in
        </Link>
      </div>
    );
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') ?? '');
    const confirm = String(form.get('confirm') ?? '');

    const parsed = resetPasswordSchema.safeParse({ password });
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }

    if (password !== confirm) {
      setErrors({ confirm: 'Those passwords do not match.' });
      return;
    }

    setErrors({});
    setSubmitting(true);

    const { error } = await resetPassword({
      newPassword: parsed.data.password,
      token: token!,
    });

    if (error) {
      setSubmitting(false);
      setFormError(
        'We could not reset your password. The link may have expired — request a new one.',
      );
      return;
    }

    router.push('/login?reset=1');
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
      <p className="text-sm text-muted mt-1.5">
        You&rsquo;ll use this to log in to FamLink from now on.
      </p>

      <form onSubmit={onSubmit} className="space-y-4 mt-7" noValidate>
        {formError && <Alert tone="error">{formError}</Alert>}

        <Field label="New password" htmlFor="password" error={errors.password}>
          <div className="relative">
            <Input
              id="password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              placeholder="At least 10 characters"
              required
              className="pr-11"
              invalid={Boolean(errors.password)}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-1 top-1 size-9 rounded-lg flex items-center justify-center text-subtle hover:text-fg transition-colors"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </Field>

        <Field label="Confirm new password" htmlFor="confirm" error={errors.confirm}>
          <Input
            id="confirm"
            name="confirm"
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            placeholder="Type it again"
            required
            invalid={Boolean(errors.confirm)}
          />
        </Field>

        <Button type="submit" size="lg" fullWidth loading={submitting}>
          Save new password
        </Button>
      </form>
    </div>
  );
}

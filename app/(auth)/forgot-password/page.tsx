'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft, MailCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/feedback';
import { requestPasswordReset } from '@/lib/auth/client';
import { fieldErrors, forgotPasswordSchema } from '@/lib/validation/auth';

export default function ForgotPasswordPage() {
  const [submitting, setSubmitting] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const form = new FormData(event.currentTarget);
    const parsed = forgotPasswordSchema.safeParse({ email: form.get('email') });

    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }

    setErrors({});
    setSubmitting(true);

    const { error } = await requestPasswordReset({
      email: parsed.data.email,
      redirectTo: '/reset-password',
    });

    setSubmitting(false);

    if (error && error.status !== 200) {
      setFormError('We could not send that email right now. Please try again shortly.');
      return;
    }

    /*
     * Always report success. Telling the visitor whether the address exists
     * would make this page an account-enumeration tool.
     */
    setSent(true);
  }

  if (sent) {
    return (
      <div className="text-center">
        <div className="size-12 rounded-2xl bg-tint-brand flex items-center justify-center mx-auto">
          <MailCheck aria-hidden className="size-6 text-brand-600" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight mt-5">Check your email</h1>
        <p className="text-sm text-muted mt-2 leading-relaxed">
          If an account exists for that address, we&rsquo;ve sent a link to reset your password.
          It expires in one hour.
        </p>
        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline mt-6"
        >
          <ArrowLeft aria-hidden className="size-4" />
          Back to log in
        </Link>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
      <p className="text-sm text-muted mt-1.5">
        Enter your email and we&rsquo;ll send you a link to choose a new password.
      </p>

      <form onSubmit={onSubmit} className="space-y-4 mt-7" noValidate>
        {formError && <Alert tone="error">{formError}</Alert>}

        <Field label="Email" htmlFor="email" error={errors.email}>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            placeholder="you@example.com"
            required
            invalid={Boolean(errors.email)}
          />
        </Field>

        <Button type="submit" size="lg" fullWidth loading={submitting}>
          Send reset link
        </Button>
      </form>

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

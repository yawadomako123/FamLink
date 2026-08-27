'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/feedback';
import { signIn } from '@/lib/auth/client';
import { fieldErrors, loginSchema } from '@/lib/validation/auth';
import { cn } from '@/lib/utils';

export function LoginForm({
  nextPath,
  justRegistered,
  className,
}: {
  nextPath: string;
  justRegistered?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [submitting, setSubmitting] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [showPassword, setShowPassword] = React.useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const form = new FormData(event.currentTarget);
    const parsed = loginSchema.safeParse({
      email: form.get('email'),
      password: form.get('password'),
    });

    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }

    setErrors({});
    setSubmitting(true);

    const { error } = await signIn.email({
      email: parsed.data.email,
      password: parsed.data.password,
      callbackURL: nextPath,
    });

    if (error) {
      setSubmitting(false);
      /*
       * Deliberately the same message for "no such account" and "wrong
       * password" — distinguishing them would let anyone test whether an
       * address has a FamLink account.
       */
      setFormError(
        error.status === 429
          ? 'Too many attempts. Please wait a moment and try again.'
          : 'That email or password is not right.',
      );
      return;
    }

    startTransition(() => {
      router.push(nextPath);
      router.refresh();
    });
  }

  const busy = submitting || pending;

  return (
    <form onSubmit={onSubmit} className={cn('space-y-4', className)} noValidate>
      {justRegistered && (
        <Alert tone="success">Your account is ready. Log in to get started.</Alert>
      )}

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
          aria-describedby={errors.email ? 'email-error' : undefined}
        />
      </Field>

      <Field label="Password" htmlFor="password" error={errors.password}>
        <div className="relative">
          <Input
            id="password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            placeholder="Your password"
            required
            className="pr-11"
            invalid={Boolean(errors.password)}
            aria-describedby={errors.password ? 'password-error' : undefined}
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

      <div className="flex justify-end">
        <Link
          href="/forgot-password"
          className="text-sm text-muted hover:text-fg transition-colors"
        >
          Forgot your password?
        </Link>
      </div>

      <Button type="submit" size="lg" fullWidth loading={busy}>
        Log in
      </Button>
    </form>
  );
}

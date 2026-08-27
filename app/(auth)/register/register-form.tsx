'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Check, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/feedback';
import { signUp } from '@/lib/auth/client';
import { fieldErrors, registerSchema } from '@/lib/validation/auth';
import { cn } from '@/lib/utils';

const MIN_PASSWORD_LENGTH = 10;

export function RegisterForm({
  inviteCode,
  className,
}: {
  inviteCode?: string | undefined;
  className?: string;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [showPassword, setShowPassword] = React.useState(false);
  const [password, setPassword] = React.useState('');

  const destination = inviteCode ? `/join/${inviteCode}` : '/dashboard';

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const form = new FormData(event.currentTarget);
    const parsed = registerSchema.safeParse({
      name: form.get('name'),
      email: form.get('email'),
      password: form.get('password'),
    });

    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }

    setErrors({});
    setSubmitting(true);

    const { error } = await signUp.email({
      name: parsed.data.name,
      email: parsed.data.email,
      password: parsed.data.password,
      callbackURL: destination,
    });

    if (error) {
      setSubmitting(false);

      if (error.code === 'USER_ALREADY_EXISTS' || error.status === 422) {
        setErrors({ email: 'An account with this email already exists.' });
        return;
      }

      setFormError('We could not create your account. Please try again.');
      return;
    }

    // Better Auth signs the user in on sign-up, so go straight in.
    router.push(destination);
    router.refresh();
  }

  const longEnough = password.length >= MIN_PASSWORD_LENGTH;

  return (
    <form onSubmit={onSubmit} className={cn('space-y-4', className)} noValidate>
      {formError && <Alert tone="error">{formError}</Alert>}

      <Field label="Your name" htmlFor="name" error={errors.name}>
        <Input
          id="name"
          name="name"
          autoComplete="name"
          placeholder="Ama Boateng"
          required
          invalid={Boolean(errors.name)}
        />
      </Field>

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

      <Field label="Password" htmlFor="password" error={errors.password}>
        <div className="relative">
          <Input
            id="password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            placeholder="At least 10 characters"
            required
            className="pr-11"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
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

      {/* Length is the only rule, so it is the only thing we show. */}
      <p
        className={cn(
          'flex items-center gap-1.5 text-xs transition-colors',
          longEnough ? 'text-brand-700' : 'text-muted',
        )}
      >
        <Check aria-hidden className={cn('size-3.5', !longEnough && 'opacity-40')} />
        At least {MIN_PASSWORD_LENGTH} characters
      </p>

      <Button type="submit" size="lg" fullWidth loading={submitting}>
        Create account
      </Button>

      <p className="text-xs text-muted text-center leading-relaxed">
        FamLink never shares your location until you explicitly turn sharing on.
      </p>
    </form>
  );
}

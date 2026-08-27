'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Home, Ticket } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/feedback';
import { api, errorMessage } from '@/lib/api/client';
import { createFamilySchema, invitationCodeSchema } from '@/lib/validation/family';
import { fieldErrors } from '@/lib/validation/auth';
import { cn } from '@/lib/utils';

type Mode = 'create' | 'join';

/**
 * The empty state for someone with no family: two equal paths, create or join.
 * Presented as a choice rather than a form with a link, because neither is the
 * obviously-correct default — it depends on whether someone invited you.
 */
export function CreateFamilyPanel({ initialCode }: { initialCode?: string }) {
  const [mode, setMode] = React.useState<Mode>(initialCode ? 'join' : 'create');

  return (
    <div className="px-4 md:px-6 py-8 max-w-lg mx-auto w-full">
      <h2 className="text-xl font-semibold tracking-tight text-center">
        Set up your family space
      </h2>
      <p className="text-sm text-muted mt-1.5 text-center text-balance">
        Start a new family, or join one you&rsquo;ve been invited to.
      </p>

      <div
        role="tablist"
        aria-label="Create or join"
        className="mt-6 grid grid-cols-2 gap-1 p-1 bg-inset rounded-xl"
      >
        <TabButton
          active={mode === 'create'}
          icon={Home}
          onClick={() => setMode('create')}
          controls="create-panel"
        >
          Create
        </TabButton>
        <TabButton
          active={mode === 'join'}
          icon={Ticket}
          onClick={() => setMode('join')}
          controls="join-panel"
        >
          Join
        </TabButton>
      </div>

      <div className="mt-6">
        {mode === 'create' ? <CreateForm /> : <JoinForm initialCode={initialCode} />}
      </div>
    </div>
  );
}

function TabButton({
  active,
  icon: Icon,
  onClick,
  controls,
  children,
}: {
  active: boolean;
  icon: React.ElementType;
  onClick: () => void;
  controls: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-controls={controls}
      onClick={onClick}
      className={cn(
        'flex items-center justify-center gap-2 h-10 rounded-lg text-sm font-medium transition-colors',
        active ? 'bg-card text-fg shadow-soft' : 'text-muted hover:text-fg',
      )}
    >
      <Icon aria-hidden className="size-4" />
      {children}
    </button>
  );
}

function CreateForm() {
  const router = useRouter();
  const [submitting, setSubmitting] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const parsed = createFamilySchema.safeParse({
      name: new FormData(event.currentTarget).get('name'),
    });

    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }

    setErrors({});
    setSubmitting(true);

    try {
      await api.post('/api/v1/families', parsed.data);
      router.push('/dashboard');
      router.refresh();
    } catch (error) {
      setSubmitting(false);
      setFormError(errorMessage(error));
    }
  }

  return (
    <form id="create-panel" role="tabpanel" onSubmit={onSubmit} className="space-y-4" noValidate>
      {formError && <Alert tone="error">{formError}</Alert>}

      <Field
        label="Family name"
        htmlFor="family-name"
        error={errors.name}
        hint="Something everyone will recognise, like “The Boatengs”."
      >
        <Input
          id="family-name"
          name="name"
          placeholder="The Boatengs"
          autoComplete="off"
          required
          invalid={Boolean(errors.name)}
        />
      </Field>

      <Button type="submit" size="lg" fullWidth loading={submitting}>
        Create family
      </Button>

      <p className="text-xs text-muted text-center leading-relaxed">
        You&rsquo;ll be the owner. Location sharing stays off until you turn it on.
      </p>
    </form>
  );
}

function JoinForm({ initialCode }: { initialCode?: string }) {
  const router = useRouter();
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const raw = String(new FormData(event.currentTarget).get('code') ?? '');
    const parsed = invitationCodeSchema.safeParse(raw);

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'That code does not look right.');
      return;
    }

    setSubmitting(true);

    try {
      await api.post('/api/v1/invitations/accept', { code: parsed.data });
      router.push('/dashboard');
      router.refresh();
    } catch (err) {
      setSubmitting(false);
      setError(errorMessage(err));
    }
  }

  return (
    <form id="join-panel" role="tabpanel" onSubmit={onSubmit} className="space-y-4" noValidate>
      {error && <Alert tone="error">{error}</Alert>}

      <Field
        label="Invite code"
        htmlFor="invite-code"
        hint="The 8-character code from your invitation link."
      >
        <Input
          id="invite-code"
          name="code"
          placeholder="ABCD2345"
          defaultValue={initialCode ?? ''}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={8}
          required
          // Codes are always uppercase; typing lowercase should just work.
          className="font-mono tracking-[0.2em] uppercase"
        />
      </Field>

      <Button type="submit" size="lg" fullWidth loading={submitting}>
        Join family
      </Button>
    </form>
  );
}

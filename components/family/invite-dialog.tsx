'use client';

import * as React from 'react';
import { Check, Copy, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { api, errorMessage } from '@/lib/api/client';
import type { AssignableRole } from '@/lib/validation/family';
import { cn } from '@/lib/utils';

interface CreatedInvite {
  code: string;
  url: string;
  expiresAt: string;
  role: AssignableRole;
}

const EXPIRY_OPTIONS = [
  { label: '24 hours', hours: 24 },
  { label: '3 days', hours: 72 },
  { label: '7 days', hours: 168 },
] as const;

/**
 * Creates an invitation and shows the link exactly once.
 *
 * The one-time reveal is not a UI limitation — FamLink stores only a hash of
 * the code, so the link genuinely cannot be shown again. The copy makes that
 * explicit rather than letting someone discover it later.
 */
export function InviteDialog({
  familyId,
  open,
  onOpenChange,
  onCreated,
}: {
  familyId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  const [role, setRole] = React.useState<AssignableRole>('member');
  const [expiresInHours, setExpiresInHours] = React.useState<number>(168);
  const [creating, setCreating] = React.useState(false);
  const [invite, setInvite] = React.useState<CreatedInvite | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  // Reset for the next invitation once the dialog has closed.
  React.useEffect(() => {
    if (open) return;
    const timer = setTimeout(() => {
      setInvite(null);
      setError(null);
      setCopied(false);
      setRole('member');
    }, 200);
    return () => clearTimeout(timer);
  }, [open]);

  async function create() {
    setCreating(true);
    setError(null);

    try {
      const result = await api.post<{ invitation: CreatedInvite }>(
        `/api/v1/families/${familyId}/invitations`,
        { role, expiresInHours },
      );
      setInvite(result.invitation);
      onCreated();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setCreating(false);
    }
  }

  async function copy() {
    if (!invite) return;

    try {
      await navigator.clipboard.writeText(invite.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard access can be denied; the link is selectable as a fallback.
      setError('Could not copy automatically — select the link and copy it manually.');
    }
  }

  return (
    <dialog
      ref={dialogRef}
      onCancel={(e) => {
        e.preventDefault();
        onOpenChange(false);
      }}
      onClose={() => onOpenChange(false)}
      className="m-auto w-[calc(100vw-2rem)] max-w-md p-0 bg-transparent backdrop:bg-black/40"
    >
      <div className="bg-card border border-line rounded-2xl shadow-lift p-5 text-left">
        {invite ? (
          <>
            <div className="size-10 rounded-xl bg-tint-brand flex items-center justify-center">
              <Link2 aria-hidden className="size-5 text-brand-600" />
            </div>

            <h2 className="text-base font-semibold mt-3">Invitation ready</h2>
            <p className="text-sm text-muted mt-1 leading-relaxed">
              Send this link to the person you&rsquo;re inviting. It works once, and expires{' '}
              {new Date(invite.expiresAt).toLocaleDateString(undefined, {
                day: 'numeric',
                month: 'short',
              })}
              .
            </p>

            <div className="mt-4 flex items-center gap-2 p-2.5 bg-inset rounded-xl border border-line">
              <code className="flex-1 text-xs font-mono text-fg truncate select-all">
                {invite.url}
              </code>
              <Button size="sm" variant={copied ? 'secondary' : 'primary'} onClick={() => void copy()}>
                {copied ? (
                  <>
                    <Check aria-hidden className="size-3.5" /> Copied
                  </>
                ) : (
                  <>
                    <Copy aria-hidden className="size-3.5" /> Copy
                  </>
                )}
              </Button>
            </div>

            {/* Alert renders its own icon; a second one here would double up. */}
            <Alert tone="warning" className="mt-3">
              Copy it now — for security, FamLink stores only a fingerprint of this code and
              cannot show the link again.
            </Alert>

            {error && (
              <p role="alert" className="text-xs text-danger-600 mt-2">
                {error}
              </p>
            )}

            <div className="mt-5 flex justify-end">
              <Button variant="secondary" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-base font-semibold">Invite someone</h2>
            <p className="text-sm text-muted mt-1">
              They&rsquo;ll get a private link to join this family.
            </p>

            {error && (
              <Alert tone="error" className="mt-4">
                {error}
              </Alert>
            )}

            <fieldset className="mt-5">
              <legend className="text-sm font-medium text-fg">Their role</legend>
              <div className="mt-2 space-y-2">
                <RoleOption
                  checked={role === 'member'}
                  onSelect={() => setRole('member')}
                  title="Member"
                  description="Can see the family map and chat."
                />
                <RoleOption
                  checked={role === 'admin'}
                  onSelect={() => setRole('admin')}
                  title="Admin"
                  description="Can also invite people, remove members and manage places."
                />
              </div>
            </fieldset>

            <fieldset className="mt-5">
              <legend className="text-sm font-medium text-fg">Link expires after</legend>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {EXPIRY_OPTIONS.map((option) => (
                  <button
                    key={option.hours}
                    type="button"
                    onClick={() => setExpiresInHours(option.hours)}
                    aria-pressed={expiresInHours === option.hours}
                    className={cn(
                      'h-10 rounded-xl text-sm font-medium border transition-colors',
                      expiresInHours === option.hours
                        ? 'border-brand-500 bg-tint-brand text-on-tint-brand'
                        : 'border-line text-muted hover:text-fg hover:bg-raised',
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </fieldset>

            <div className="mt-6 flex gap-2 justify-end">
              <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={creating}>
                Cancel
              </Button>
              <Button loading={creating} onClick={() => void create()}>
                Create invite link
              </Button>
            </div>
          </>
        )}
      </div>
    </dialog>
  );
}

function RoleOption({
  checked,
  onSelect,
  title,
  description,
}: {
  checked: boolean;
  onSelect: () => void;
  title: string;
  description: string;
}) {
  return (
    <label
      className={cn(
        'flex gap-3 p-3 rounded-xl border cursor-pointer transition-colors',
        checked ? 'border-brand-500 bg-tint-brand' : 'border-line hover:bg-raised',
      )}
    >
      <input
        type="radio"
        name="invite-role"
        checked={checked}
        onChange={onSelect}
        className="mt-0.5 accent-brand-600"
      />
      <span>
        <span className={cn('block text-sm font-medium', checked ? 'text-on-tint-brand' : 'text-fg')}>
          {title}
        </span>
        <span className={cn('block text-xs mt-0.5', checked ? 'text-on-tint-brand' : 'text-muted')}>
          {description}
        </span>
      </span>
    </label>
  );
}

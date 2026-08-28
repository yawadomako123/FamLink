'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Crown,
  LogOut,
  MoreVertical,
  Pencil,
  ShieldCheck,
  Ticket,
  Trash2,
  UserPlus,
} from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Alert, EmptyState } from '@/components/ui/feedback';
import { StatusDot } from '@/components/ui/status-dot';
import { Input } from '@/components/ui/input';
import { InviteDialog } from './invite-dialog';
import { AskCheckInButton } from '@/components/checkins/check-in-panel';
import { api, errorMessage } from '@/lib/api/client';
import { timeAgo } from '@/lib/time';
import { cn } from '@/lib/utils';
import type { FamilyMemberView, FamilySummary, InvitationView } from '@/lib/families/queries';
import type { FamilyRole } from '@/lib/db/schema';

const ROLE_LABEL: Record<FamilyRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
};

/** Reads naturally in "you're the owner" / "you're an admin" / "you're a member". */
const ROLE_PHRASE: Record<FamilyRole, string> = {
  owner: 'the owner',
  admin: 'an admin',
  member: 'a member',
};

export function FamilyView({
  family,
  members,
  invitations,
  viewerId,
}: {
  family: FamilySummary;
  families: FamilySummary[];
  members: FamilyMemberView[];
  invitations: InvitationView[];
  viewerId: string;
}) {
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [renaming, setRenaming] = React.useState(false);
  const [leaveOpen, setLeaveOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [pendingRemoval, setPendingRemoval] = React.useState<FamilyMemberView | null>(null);

  const isOwner = family.role === 'owner';
  const canManage = family.role === 'owner' || family.role === 'admin';
  const otherMembers = members.filter((m) => m.userId !== viewerId);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      router.refresh();
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-4 md:px-6 py-6 max-w-3xl space-y-5">
      {error && (
        <Alert tone="error" action={<Button size="sm" variant="ghost" onClick={() => setError(null)}>Dismiss</Button>}>
          {error}
        </Alert>
      )}

      {/* ---------------------------------------------------------------- */}
      <Card>
        <CardHeader className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {renaming ? (
              <RenameForm
                familyId={family.id}
                initialName={family.name}
                onDone={() => {
                  setRenaming(false);
                  router.refresh();
                }}
                onCancel={() => setRenaming(false)}
                onError={setError}
              />
            ) : (
              <>
                <CardTitle className="truncate">{family.name}</CardTitle>
                <p className="text-sm text-muted mt-1">
                  {members.length} {members.length === 1 ? 'member' : 'members'} · you&rsquo;re{' '}
                  {ROLE_PHRASE[family.role]}
                </p>
              </>
            )}
          </div>

          {canManage && !renaming && (
            <Button size="sm" variant="ghost" onClick={() => setRenaming(true)}>
              <Pencil aria-hidden className="size-3.5" />
              Rename
            </Button>
          )}
        </CardHeader>
      </Card>

      {/* ---------------------------------------------------------------- */}
      <Card>
        <CardHeader className="flex items-center justify-between gap-3">
          <CardTitle>Members</CardTitle>
          {canManage && (
            <Button size="sm" onClick={() => setInviteOpen(true)}>
              <UserPlus aria-hidden className="size-3.5" />
              Invite
            </Button>
          )}
        </CardHeader>

        <ul className="divide-y divide-line border-t border-line">
          {members.map((member) => (
            <MemberRow
              key={member.userId}
              member={member}
              familyId={family.id}
              isSelf={member.userId === viewerId}
              viewerRole={family.role}
              busy={busy}
              onRemove={() => setPendingRemoval(member)}
              onPromote={() =>
                void run(() =>
                  api.patch(`/api/v1/families/${family.id}/members/${member.userId}`, {
                    role: member.role === 'admin' ? 'member' : 'admin',
                  }),
                )
              }
              onTransfer={() =>
                void run(() =>
                  api.post(`/api/v1/families/${family.id}/transfer-ownership`, {
                    userId: member.userId,
                  }),
                )
              }
            />
          ))}
        </ul>
      </Card>

      {/* ---------------------------------------------------------------- */}
      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>Open invitations</CardTitle>
          </CardHeader>

          {invitations.length === 0 ? (
            <EmptyState
              icon={Ticket}
              title="No open invitations"
              description="Create an invite link to add someone to this family."
              className="py-8"
            />
          ) : (
            <ul className="divide-y divide-line border-t border-line">
              {invitations.map((invitation) => (
                <li key={invitation.id} className="flex items-center gap-2 px-5 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-fg">
                      {ROLE_LABEL[invitation.role]} invite
                      {invitation.status !== 'valid' && (
                        <span className="ml-2 text-xs font-normal text-danger-600">
                          {invitation.status}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted mt-0.5">
                      From {invitation.createdByName} · created{' '}
                      {timeAgo(invitation.createdAt)}
                      {invitation.status === 'valid' && (
                        <> · expires {new Date(invitation.expiresAt).toLocaleDateString()}</>
                      )}
                    </p>
                  </div>

                  <Button
                    size="sm"
                    variant="ghost"
                    className="shrink-0"
                    disabled={busy}
                    onClick={() =>
                      void run(() =>
                        api.delete(
                          `/api/v1/families/${family.id}/invitations/${invitation.id}`,
                        ),
                      )
                    }
                  >
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {/* ---------------------------------------------------------------- */}
      <Card>
        <CardContent className="pt-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-fg">Leave this family</p>
              <p className="text-xs text-muted mt-1 leading-relaxed max-w-sm">
                {isOwner && otherMembers.length > 0
                  ? 'As the owner, transfer ownership to another member before you can leave.'
                  : isOwner
                    ? 'You are the last member, so leaving will delete this family and everything in it.'
                    : 'You will stop sharing your location with this family and lose access to its map and chat.'}
              </p>
            </div>
            <Button
              variant="danger"
              size="sm"
              className="shrink-0"
              disabled={isOwner && otherMembers.length > 0}
              onClick={() => setLeaveOpen(true)}
            >
              <LogOut aria-hidden className="size-3.5" />
              Leave
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ---------------------------------------------------------------- */}
      <InviteDialog
        familyId={family.id}
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        onCreated={() => router.refresh()}
      />

      <ConfirmDialog
        open={pendingRemoval !== null}
        onOpenChange={(open) => !open && setPendingRemoval(null)}
        title={`Remove ${pendingRemoval?.name ?? 'this member'}?`}
        description="They'll lose access to this family's map and chat straight away. You can invite them back later."
        confirmLabel="Remove"
        tone="danger"
        loading={busy}
        onConfirm={async () => {
          if (!pendingRemoval) return;
          const done = await run(() =>
            api.delete(`/api/v1/families/${family.id}/members/${pendingRemoval.userId}`),
          );
          if (done) setPendingRemoval(null);
        }}
      />

      <ConfirmDialog
        open={leaveOpen}
        onOpenChange={setLeaveOpen}
        title={
          isOwner && otherMembers.length === 0 ? 'Delete this family?' : `Leave ${family.name}?`
        }
        description={
          isOwner && otherMembers.length === 0
            ? 'This permanently deletes the family along with its places, chat history and alerts. This cannot be undone.'
            : "You'll stop sharing your location with this family and lose access to its map and chat."
        }
        confirmLabel={isOwner && otherMembers.length === 0 ? 'Delete family' : 'Leave'}
        tone="danger"
        loading={busy}
        onConfirm={async () => {
          const done = await run(() => api.post(`/api/v1/families/${family.id}/leave`));
          if (done) {
            setLeaveOpen(false);
            router.push('/dashboard');
          }
        }}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function MemberRow({
  member,
  familyId,
  isSelf,
  viewerRole,
  busy,
  onRemove,
  onPromote,
  onTransfer,
}: {
  member: FamilyMemberView;
  familyId: string;
  isSelf: boolean;
  viewerRole: FamilyRole;
  busy: boolean;
  onRemove: () => void;
  onPromote: () => void;
  onTransfer: () => void;
}) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [menuOpen]);

  const sharing = member.locationSharingState;
  const isOwnerRow = member.role === 'owner';

  // Only the owner manages roles, and nobody manages the owner.
  const canAct = viewerRole === 'owner' && !isSelf && !isOwnerRow;
  // Admins may remove plain members, but not each other.
  const canRemoveOnly =
    viewerRole === 'admin' && !isSelf && member.role === 'member';

  return (
    /*
     * The identity block owns the row's flexible width and everything else is
     * shrink-0. On a 360px phone this row previously asked a name, a sharing
     * status, a "Check in" label, a role pill and a menu to share about 280px,
     * and the name wrapped to three lines to make room.
     */
    <li className="flex items-center gap-2 sm:gap-3 px-5 py-3">
      <Avatar name={member.name} userId={member.userId} image={member.image} size="md" />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <p className="text-sm font-medium text-fg truncate">
            {member.name}
            {isSelf && <span className="text-muted font-normal"> (you)</span>}
          </p>

          {/* Beside the name, not competing with it. "Member" is the default
              and says nothing, so it only appears where space is free. */}
          <span
            className={cn(
              'shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded-md',
              isOwnerRow
                ? 'bg-tint-brand text-on-tint-brand'
                : member.role === 'admin'
                  ? 'bg-inset text-muted'
                  : 'hidden sm:inline-flex text-subtle',
            )}
          >
            {isOwnerRow && <Crown aria-hidden className="size-3" />}
            {member.role === 'admin' && <ShieldCheck aria-hidden className="size-3" />}
            {ROLE_LABEL[member.role]}
          </span>
        </div>

        <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
          <StatusDot
            status={
              sharing === 'sharing' ? 'sharing' : sharing === 'paused' ? 'paused' : 'offline'
            }
          />
          <span className="text-xs text-muted truncate">
            {sharing === 'sharing'
              ? 'Sharing location'
              : sharing === 'paused'
                ? 'Location paused'
                : 'Not sharing location'}
          </span>
        </div>
      </div>

      {/* Asking somebody if they are OK needs no role or permission. */}
      {!isSelf && (
        <AskCheckInButton
          familyId={familyId}
          targetId={member.userId}
          targetName={member.name}
        />
      )}

      {(canAct || canRemoveOnly) && (
        <div ref={menuRef} className="relative shrink-0">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            disabled={busy}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={`Manage ${member.name}`}
            className="size-8 rounded-lg flex items-center justify-center text-subtle hover:text-fg hover:bg-raised transition-colors"
          >
            <MoreVertical aria-hidden className="size-4" />
          </button>

          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full mt-1 w-52 bg-card border border-line rounded-xl shadow-lift overflow-hidden z-10 p-1"
            >
              {canAct && (
                <>
                  <MenuItem
                    onSelect={() => {
                      setMenuOpen(false);
                      onPromote();
                    }}
                    icon={ShieldCheck}
                  >
                    {member.role === 'admin' ? 'Make member' : 'Make admin'}
                  </MenuItem>
                  <MenuItem
                    onSelect={() => {
                      setMenuOpen(false);
                      onTransfer();
                    }}
                    icon={Crown}
                  >
                    Transfer ownership
                  </MenuItem>
                </>
              )}
              <MenuItem
                onSelect={() => {
                  setMenuOpen(false);
                  onRemove();
                }}
                icon={Trash2}
                danger
              >
                Remove from family
              </MenuItem>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function MenuItem({
  onSelect,
  icon: Icon,
  danger,
  children,
}: {
  onSelect: () => void;
  icon: React.ElementType;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      className={cn(
        'w-full flex items-center gap-2.5 h-9 px-2.5 rounded-lg text-sm transition-colors',
        danger ? 'text-danger-600 hover:bg-tint-danger' : 'text-fg hover:bg-raised',
      )}
    >
      <Icon aria-hidden className="size-4" />
      {children}
    </button>
  );
}

function RenameForm({
  familyId,
  initialName,
  onDone,
  onCancel,
  onError,
}: {
  familyId: string;
  initialName: string;
  onDone: () => void;
  onCancel: () => void;
  onError: (message: string) => void;
}) {
  const [saving, setSaving] = React.useState(false);

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        const name = String(new FormData(event.currentTarget).get('name') ?? '').trim();
        if (!name || name === initialName) return onCancel();

        setSaving(true);
        try {
          await api.patch(`/api/v1/families/${familyId}`, { name });
          onDone();
        } catch (err) {
          onError(errorMessage(err));
          setSaving(false);
        }
      }}
      className="flex items-center gap-2"
    >
      <Input
        name="name"
        defaultValue={initialName}
        aria-label="Family name"
        autoFocus
        maxLength={60}
        className="h-9"
      />
      <Button type="submit" size="sm" loading={saving}>
        Save
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={saving}>
        Cancel
      </Button>
    </form>
  );
}

import type { Metadata } from 'next';
import { AppShell } from '@/components/layout/app-shell';
import { requireSession } from '@/lib/auth/session';
import { resolveShellData } from '@/lib/families/shell';
import { listFamilyInvitations, listFamilyMembers } from '@/lib/families/queries';
import { roleAtLeast } from '@/lib/permissions/location-visibility';
import { CreateFamilyPanel } from '@/components/family/create-family-panel';
import { FamilyView } from '@/components/family/family-view';

export const metadata: Metadata = { title: 'Family' };

export default async function FamilyPage() {
  const session = await requireSession('/family');
  const {
    family: current,
    families,
    alertCount,
    unreadMessages,
  } = await resolveShellData(session.user.id);

  // No family yet — the whole page becomes the create/join choice.
  if (!current) {
    return (
      <AppShell user={session.user} title="Family">
        <CreateFamilyPanel />
      </AppShell>
    );
  }

  const canManage = roleAtLeast(current.role, 'admin');

  const [members, invitations] = await Promise.all([
    listFamilyMembers(session.user.id, current.id),
    // Only admins and owners may enumerate open invitations.
    canManage ? listFamilyInvitations(session.user.id, current.id) : Promise.resolve([]),
  ]);

  return (
    <AppShell
      user={session.user}
      familyName={current.name}
      title="Family"
      alertCount={alertCount}
      unreadMessages={unreadMessages}
    >
      <FamilyView
        family={current}
        families={families}
        members={members}
        invitations={invitations}
        viewerId={session.user.id}
      />
    </AppShell>
  );
}

import type { Metadata } from 'next';
import { AppShell } from '@/components/layout/app-shell';
import { CreateFamilyPanel } from '@/components/family/create-family-panel';
import { requireSession } from '@/lib/auth/session';
import { resolveShellData } from '@/lib/families/shell';

export const metadata: Metadata = { title: 'Add a family' };

/**
 * Create or join an additional family.
 *
 * Separate from /family, which shows the family you are currently in. Reached
 * from the switcher, so somebody already in one household can join another
 * without leaving the first.
 */
export default async function NewFamilyPage() {
  const session = await requireSession('/family/new');
  const { family: current, families, alertCount, unreadMessages } = await resolveShellData(
    session.user.id,
  );

  return (
    <AppShell
      user={session.user}
      familyName={current?.name}
      title="Add a family"
      family={current ?? undefined}
      families={families}
      alertCount={alertCount}
      unreadMessages={unreadMessages}
    >
      <CreateFamilyPanel />
    </AppShell>
  );
}

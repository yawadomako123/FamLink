import type { Metadata } from 'next';
import { Settings } from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { PhasePlaceholder } from '@/components/layout/phase-placeholder';
import { requireSession } from '@/lib/auth/session';
import { resolveCurrentFamily } from '@/lib/families/current';

export const metadata: Metadata = { title: 'Settings' };

export default async function Page() {
  const session = await requireSession('/settings');
  const { current } = await resolveCurrentFamily(session.user.id);

  return (
    <AppShell user={session.user} familyName={current?.name} title="Settings">
      <PhasePlaceholder
        icon={Settings}
        title="Settings arrive in phase 3"
        description="Location sharing, privacy and notification preferences."
      />
    </AppShell>
  );
}

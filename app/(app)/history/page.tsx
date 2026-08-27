import type { Metadata } from 'next';
import { History } from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { PhasePlaceholder } from '@/components/layout/phase-placeholder';
import { requireSession } from '@/lib/auth/session';
import { resolveCurrentFamily } from '@/lib/families/current';

export const metadata: Metadata = { title: 'My history' };

export default async function Page() {
  const session = await requireSession('/history');
  const { current } = await resolveCurrentFamily(session.user.id);

  return (
    <AppShell user={session.user} familyName={current?.name} title="My history">
      <PhasePlaceholder
        icon={History}
        title="Location history arrives in phase 3"
        description="Your own timeline of where you've been. Only you can see it."
      />
    </AppShell>
  );
}

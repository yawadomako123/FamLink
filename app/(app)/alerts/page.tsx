import type { Metadata } from 'next';
import { Bell } from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { PhasePlaceholder } from '@/components/layout/phase-placeholder';
import { requireSession } from '@/lib/auth/session';
import { resolveCurrentFamily } from '@/lib/families/current';

export const metadata: Metadata = { title: 'Alerts' };

export default async function Page() {
  const session = await requireSession('/alerts');
  const { current } = await resolveCurrentFamily(session.user.id);

  return (
    <AppShell user={session.user} familyName={current?.name} title="Alerts">
      <PhasePlaceholder
        icon={Bell}
        title="Alerts arrive in phase 6"
        description="Arrival and departure notifications, plus emergency SOS alerts from your family."
      />
    </AppShell>
  );
}

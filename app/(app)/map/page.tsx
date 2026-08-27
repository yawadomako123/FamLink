import type { Metadata } from 'next';
import { Map } from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { PhasePlaceholder } from '@/components/layout/phase-placeholder';
import { requireSession } from '@/lib/auth/session';
import { resolveCurrentFamily } from '@/lib/families/current';

export const metadata: Metadata = { title: 'Map' };

export default async function Page() {
  const session = await requireSession('/map');
  const { current } = await resolveCurrentFamily(session.user.id);

  return (
    <AppShell user={session.user} familyName={current?.name} title="Map">
      <PhasePlaceholder
        icon={Map}
        title="The family map arrives in phase 4"
        description="It needs location sharing, which is being built in phase 3. Everyone who opts in will appear here."
      />
    </AppShell>
  );
}

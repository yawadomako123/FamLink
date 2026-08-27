import type { Metadata } from 'next';
import { MapPin } from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { PhasePlaceholder } from '@/components/layout/phase-placeholder';
import { requireSession } from '@/lib/auth/session';
import { resolveCurrentFamily } from '@/lib/families/current';

export const metadata: Metadata = { title: 'Places' };

export default async function Page() {
  const session = await requireSession('/places');
  const { current } = await resolveCurrentFamily(session.user.id);

  return (
    <AppShell user={session.user} familyName={current?.name} title="Places">
      <PhasePlaceholder
        icon={MapPin}
        title="Places arrive in phase 5"
        description="Name the locations that matter — Home, School, Work — and get told when someone arrives or leaves."
      />
    </AppShell>
  );
}

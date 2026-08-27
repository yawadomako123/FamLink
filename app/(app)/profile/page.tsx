import type { Metadata } from 'next';
import { User } from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { PhasePlaceholder } from '@/components/layout/phase-placeholder';
import { requireSession } from '@/lib/auth/session';
import { resolveCurrentFamily } from '@/lib/families/current';

export const metadata: Metadata = { title: 'Profile' };

export default async function Page() {
  const session = await requireSession('/profile');
  const { current } = await resolveCurrentFamily(session.user.id);

  return (
    <AppShell user={session.user} familyName={current?.name} title="Profile">
      <PhasePlaceholder
        icon={User}
        title="Profile settings arrive in phase 3"
        description="Change your name and avatar, and manage location sharing and notifications."
      />
    </AppShell>
  );
}

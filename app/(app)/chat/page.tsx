import type { Metadata } from 'next';
import { MessageCircle } from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { PhasePlaceholder } from '@/components/layout/phase-placeholder';
import { requireSession } from '@/lib/auth/session';
import { resolveCurrentFamily } from '@/lib/families/current';

export const metadata: Metadata = { title: 'Chat' };

export default async function Page() {
  const session = await requireSession('/chat');
  const { current } = await resolveCurrentFamily(session.user.id);

  return (
    <AppShell user={session.user} familyName={current?.name} title="Chat">
      <PhasePlaceholder
        icon={MessageCircle}
        title="Family chat arrives in phase 7"
        description="One realtime conversation for the whole family, with unread counts."
      />
    </AppShell>
  );
}

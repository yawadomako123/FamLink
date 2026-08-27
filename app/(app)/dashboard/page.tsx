import type { Metadata } from 'next';
import Link from 'next/link';
import { Users } from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/feedback';
import { requireSession } from '@/lib/auth/session';

export const metadata: Metadata = { title: 'Home' };

/**
 * Phase 1 dashboard.
 *
 * Deliberately thin: it proves the authenticated shell renders and the session
 * resolves. The family map, member list and status cards land in phases 2–4,
 * once there is real family data to render.
 */
export default async function DashboardPage() {
  const session = await requireSession('/dashboard');

  return (
    <AppShell user={session.user} title="Home">
      <div className="px-4 md:px-6 py-6 max-w-3xl">
        <h2 className="text-xl font-semibold tracking-tight">
          Hello, {session.user.name.split(' ')[0]}
        </h2>

        <div className="mt-6 bg-card border border-line rounded-2xl shadow-soft">
          <EmptyState
            icon={Users}
            title="You're not in a family yet"
            description="Create a family space and invite the people you want to stay connected with."
            action={
              <Link href="/family">
                <Button size="lg">Create a family</Button>
              </Link>
            }
          />
        </div>
      </div>
    </AppShell>
  );
}

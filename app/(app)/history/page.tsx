import type { Metadata } from 'next';
import Link from 'next/link';
import { History as HistoryIcon, Lock } from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { Card } from '@/components/ui/card';
import { Alert, EmptyState } from '@/components/ui/feedback';
import { Button } from '@/components/ui/button';
import { HistoryTimeline } from '@/components/location/history-timeline';
import { requireSession } from '@/lib/auth/session';
import { resolveCurrentFamily } from '@/lib/families/current';

export const metadata: Metadata = { title: 'My history' };

export default async function HistoryPage() {
  const session = await requireSession('/history');
  const { current } = await resolveCurrentFamily(session.user.id);

  if (!current) {
    return (
      <AppShell user={session.user} title="My history">
        <div className="px-4 md:px-6 py-6 max-w-2xl">
          <Card>
            <EmptyState
              icon={HistoryIcon}
              title="No history yet"
              description="Location history starts once you're in a family and sharing is switched on."
              action={
                <Link href="/family">
                  <Button>Set up a family</Button>
                </Link>
              }
            />
          </Card>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell user={session.user} familyName={current.name} title="My history">
      <div className="px-4 md:px-6 py-6 max-w-2xl space-y-4">
        {/*
          Stated up front rather than buried in settings: this page shows only
          the viewer's own movements. Family-wide history is a separate feature
          with its own consent model and is not part of the MVP.
        */}
        <Alert tone="info" title="This is yours alone">
          <span className="inline-flex items-center gap-1.5">
            <Lock aria-hidden className="size-3.5" />
            Nobody else in {current.name} can see your location history.
          </span>
        </Alert>

        <HistoryTimeline familyId={current.id} />
      </div>
    </AppShell>
  );
}

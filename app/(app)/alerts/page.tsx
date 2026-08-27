import type { Metadata } from 'next';
import Link from 'next/link';
import { Bell } from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/feedback';
import { AlertsView } from '@/components/alerts/alerts-view';
import { SosButton } from '@/components/alerts/sos-button';
import { requireSession } from '@/lib/auth/session';
import { resolveShellData } from '@/lib/families/shell';
import { listNotifications } from '@/lib/notifications/service';
import { listActiveEmergencies } from '@/lib/notifications/emergency';
import { listPendingForMe } from '@/lib/checkins/service';
import { CheckInPanel } from '@/components/checkins/check-in-panel';

export const metadata: Metadata = { title: 'Alerts' };

export default async function AlertsPage() {
  const session = await requireSession('/alerts');
  const { family: current, families, alertCount, unreadMessages } = await resolveShellData(
    session.user.id,
  );

  if (!current) {
    return (
      <AppShell user={session.user} title="Alerts">
        <div className="px-4 md:px-6 py-6 max-w-2xl">
          <Card>
            <EmptyState
              icon={Bell}
              title="No alerts yet"
              description="Join a family to get arrival alerts and emergency notifications."
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

  const [notifications, emergencies, pendingCheckIns] = await Promise.all([
    listNotifications(session.user.id, current.id),
    listActiveEmergencies(session.user.id, current.id),
    listPendingForMe(session.user.id, current.id),
  ]);

  return (
    <AppShell
      user={session.user}
      familyName={current.name}
      family={current ?? undefined}
      families={families}
      alertCount={alertCount}
      unreadMessages={unreadMessages}
      title="Alerts"
      headerRight={<SosButton familyId={current.id} familyName={current.name} compact />}
    >
      {/* Above the alert list: a question waiting on you outranks a log. */}
      {pendingCheckIns.length > 0 && (
        <div className="px-4 md:px-6 pt-6 max-w-2xl">
          <CheckInPanel
            familyId={current.id}
            pending={pendingCheckIns.map((c) => ({
              id: c.id,
              requesterId: c.requesterId,
              requesterName: c.requesterName,
              note: c.note,
              createdAt: c.createdAt.toISOString(),
            }))}
          />
        </div>
      )}

      <AlertsView
        familyId={current.id}
        viewerId={session.user.id}
        // Dates are serialised for the client boundary; the components render
        // them as relative times, so ISO strings are the right shape here.
        initialNotifications={notifications.map((n) => ({
          id: n.id,
          type: n.type,
          title: n.title,
          message: n.message,
          readAt: n.readAt?.toISOString() ?? null,
          createdAt: n.createdAt.toISOString(),
        }))}
        initialEmergencies={emergencies.map((e) => ({
          id: e.id,
          userId: e.userId,
          memberName: e.memberName,
          latitude: e.latitude,
          longitude: e.longitude,
          status: e.status,
          createdAt: e.createdAt.toISOString(),
        }))}
      />
    </AppShell>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { MapPin, MessageCircle, Users } from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/feedback';
import { StatusDot, type PresenceStatus } from '@/components/ui/status-dot';
import { requireSession } from '@/lib/auth/session';
import { resolveCurrentFamily } from '@/lib/families/current';
import { listFamilyMembers } from '@/lib/families/queries';
import { locationFreshness } from '@/lib/time';

export const metadata: Metadata = { title: 'Home' };

export default async function DashboardPage() {
  const session = await requireSession('/dashboard');
  const { current } = await resolveCurrentFamily(session.user.id);

  if (!current) {
    return (
      <AppShell user={session.user} title="Home">
        <div className="px-4 md:px-6 py-6 max-w-3xl">
          <h2 className="text-xl font-semibold tracking-tight">
            Hello, {session.user.name.split(' ')[0]}
          </h2>

          <Card className="mt-6">
            <EmptyState
              icon={Users}
              title="You're not in a family yet"
              description="Create a family space and invite the people you want to stay connected with."
              action={
                <Link href="/family">
                  <Button size="lg">Get started</Button>
                </Link>
              }
            />
          </Card>
        </div>
      </AppShell>
    );
  }

  const members = await listFamilyMembers(session.user.id, current.id);
  const others = members.filter((m) => m.userId !== session.user.id);

  return (
    <AppShell user={session.user} familyName={current.name} title="Home">
      <div className="px-4 md:px-6 py-6 max-w-3xl space-y-5">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">
            Hello, {session.user.name.split(' ')[0]}
          </h2>
          <p className="text-sm text-muted mt-1">
            {others.length === 0
              ? `You're the only one in ${current.name} so far.`
              : `${others.length} ${others.length === 1 ? 'person' : 'people'} in ${current.name}.`}
          </p>
        </div>

        {/*
          The map is the visual centrepiece of the product, but it needs
          location data to be worth showing. It arrives in phase 4; until then
          this states plainly what is missing rather than rendering an empty
          map that implies nobody is anywhere.
        */}
        <Card>
          <EmptyState
            icon={MapPin}
            title="The family map is coming next"
            description="Once location sharing is switched on, everyone who opts in will appear here."
            className="py-10"
          />
        </Card>

        <Card>
          <CardHeader className="flex items-center justify-between">
            <CardTitle>Family members</CardTitle>
            <Link href="/family">
              <Button size="sm" variant="ghost">
                Manage
              </Button>
            </Link>
          </CardHeader>

          <ul className="divide-y divide-line border-t border-line">
            {members.map((member) => {
              // Nothing has written a location yet, so freshness is unknown for
              // everyone — but the component is already honest about it.
              const freshness = locationFreshness(null);

              const status: PresenceStatus =
                member.locationSharingState === 'sharing'
                  ? freshness.state === 'live'
                    ? 'sharing'
                    : 'stale'
                  : member.locationSharingState === 'paused'
                    ? 'paused'
                    : 'offline';

              return (
                <li key={member.userId} className="flex items-center gap-3 px-5 py-3.5">
                  <Avatar
                    name={member.name}
                    userId={member.userId}
                    image={member.image}
                    size="md"
                  />

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-fg truncate">
                      {member.name}
                      {member.userId === session.user.id && (
                        <span className="text-muted font-normal"> (you)</span>
                      )}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <StatusDot status={status} />
                      <span className="text-xs text-muted">
                        {member.locationSharingState === 'sharing'
                          ? freshness.label
                          : member.locationSharingState === 'paused'
                            ? 'Location paused'
                            : 'Not sharing location'}
                      </span>
                    </div>
                  </div>

                  {/* Battery is optional and absent until a client reports it. */}
                  {member.batteryPercentage !== null && (
                    <span className="text-xs text-muted tabular-nums">
                      {member.batteryPercentage}%
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>

        <div className="grid grid-cols-2 gap-3">
          <Link href="/chat">
            <Card className="h-full transition-colors hover:bg-raised">
              <CardHeader>
                <MessageCircle aria-hidden className="size-5 text-brand-600" />
                <CardTitle className="mt-2 text-sm">Family chat</CardTitle>
              </CardHeader>
            </Card>
          </Link>
          <Link href="/places">
            <Card className="h-full transition-colors hover:bg-raised">
              <CardHeader>
                <MapPin aria-hidden className="size-5 text-brand-600" />
                <CardTitle className="mt-2 text-sm">Places</CardTitle>
              </CardHeader>
            </Card>
          </Link>
        </div>
      </div>
    </AppShell>
  );
}

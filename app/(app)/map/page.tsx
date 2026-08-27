import type { Metadata } from 'next';
import Link from 'next/link';
import { Users } from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/feedback';
import { MapView } from '@/components/map/map-view';
import { requireSession } from '@/lib/auth/session';
import { resolveShellData } from '@/lib/families/shell';
import { listFamilyMembers } from '@/lib/families/queries';
import { getCurrentPlaces } from '@/lib/places/service';

export const metadata: Metadata = { title: 'Map' };

export default async function MapPage() {
  const session = await requireSession('/map');
  const { family: current, alertCount, unreadMessages } = await resolveShellData(
    session.user.id,
  );

  if (!current) {
    return (
      <AppShell user={session.user} title="Map">
        <div className="px-4 md:px-6 py-6 max-w-2xl">
          <Card>
            <EmptyState
              icon={Users}
              title="No family map yet"
              description="Create or join a family, then everyone who chooses to share will appear here."
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

  /*
   * Names are fetched server-side so the member list can identify people whose
   * *location* is withheld. Deliberately separate from the locations endpoint:
   * knowing who is in your family is not the same permission as knowing where
   * they are, and conflating the two would mean the map's response had to carry
   * identities for people it must not locate.
   */
  const [members, currentPlaces] = await Promise.all([
    listFamilyMembers(session.user.id, current.id),
    getCurrentPlaces(session.user.id, current.id),
  ]);

  const memberNames = Object.fromEntries(
    members.map((m) => [m.userId, { name: m.name, image: m.image }]),
  );

  /*
   * Place labels come from recorded geofence state, not recomputed here, so
   * "At Home" always agrees with the arrival event the family was told about.
   */
  const placeLabels = Object.fromEntries(
    [...currentPlaces.entries()].map(([userId, place]) => [userId, place.placeName]),
  );

  return (
    <AppShell
      user={session.user}
      familyName={current.name}
      title="Map"
      alertCount={alertCount}
      unreadMessages={unreadMessages}
      fullBleed
    >
      <MapView
        familyId={current.id}
        familyName={current.name}
        memberNames={memberNames}
        placeLabels={placeLabels}
      />
    </AppShell>
  );
}

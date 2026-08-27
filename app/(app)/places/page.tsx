import type { Metadata } from 'next';
import Link from 'next/link';
import { MapPin } from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/feedback';
import { PlacesView } from '@/components/places/places-view';
import { requireSession } from '@/lib/auth/session';
import { resolveShellData } from '@/lib/families/shell';
import { listPlaces } from '@/lib/places/service';
import { getFamilyLocations } from '@/lib/location/service';
import { getMembership } from '@/lib/permissions/family';

export const metadata: Metadata = { title: 'Places' };

export default async function PlacesPage() {
  const session = await requireSession('/places');
  const { family: current, alertCount, unreadMessages } = await resolveShellData(
    session.user.id,
  );

  if (!current) {
    return (
      <AppShell user={session.user} title="Places">
        <div className="px-4 md:px-6 py-6 max-w-2xl">
          <Card>
            <EmptyState
              icon={MapPin}
              title="Places need a family"
              description="Create or join a family first, then add the places that matter to you."
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

  const [places, membership] = await Promise.all([
    listPlaces(session.user.id, current.id),
    getMembership(session.user.id, current.id),
  ]);

  // Edit rights are decided on the server and passed down as data; the UI
  // hides controls accordingly, but the API refuses regardless.
  const isAdmin = membership?.role === 'owner' || membership?.role === 'admin';
  const canEdit = Object.fromEntries(
    places.map((p) => [p.id, isAdmin || p.createdBy === session.user.id]),
  );

  /*
   * Centre a new place on the viewer's own last position when there is one, so
   * the map opens somewhere recognisable. Uses the authorized read, so this
   * cannot become a way to learn a location the viewer may not see.
   */
  const { locations } = await getFamilyLocations(session.user.id, current.id);
  const own = locations.find((l) => l.userId === session.user.id);
  const suggestedCentre = own
    ? { latitude: own.latitude, longitude: own.longitude }
    : null;

  return (
    <AppShell
      user={session.user}
      familyName={current.name}
      title="Places"
      alertCount={alertCount}
      unreadMessages={unreadMessages}
    >
      <PlacesView
        familyId={current.id}
        places={places}
        canEdit={canEdit}
        suggestedCentre={suggestedCentre}
      />
    </AppShell>
  );
}

'use client';

import * as React from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { ArrowRight, MapPinOff } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/feedback';
import { useFamilyLocations } from '@/hooks/useFamilyLocations';

const FamilyMap = dynamic(() => import('./family-map').then((m) => m.FamilyMap), {
  ssr: false,
  loading: () => <div className="absolute inset-0 skeleton" aria-hidden />,
});

/**
 * Compact map preview for the dashboard.
 *
 * Non-interactive by design: it is a glance, not a workspace. Tapping anywhere
 * opens the full map rather than starting a pan the card is too small to make
 * useful.
 */
export function DashboardMapCard({
  familyId,
  familyName,
}: {
  familyId: string;
  familyName: string;
}) {
  const { locations, withheld, loading } = useFamilyLocations(familyId);

  const sharing = locations.length;
  const total = sharing + withheld.length;

  if (!loading && sharing === 0) {
    return (
      <Card>
        <EmptyState
          icon={MapPinOff}
          title="Nobody is sharing yet"
          description={`Turn on location sharing, or wait for someone in ${familyName} to. Everyone who opts in appears on the map.`}
          action={
            <Link
              href="/map"
              className="text-sm font-medium text-on-tint-brand hover:underline"
            >
              Open the map
            </Link>
          }
          className="py-10"
        />
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <Link href="/map" className="block group">
        <div className="relative h-52">
          <FamilyMap locations={locations} className="absolute inset-0" />
          {/* Swallows map interaction so the whole card behaves as one link. */}
          <span aria-hidden className="absolute inset-0 z-10" />
        </div>

        <div className="flex items-center gap-2 px-5 py-3.5 border-t border-line">
          <p className="flex-1 text-sm text-fg">
            <span className="font-medium">
              {sharing} of {total}
            </span>{' '}
            <span className="text-muted">sharing location</span>
          </p>
          <span className="flex items-center gap-1 text-sm font-medium text-on-tint-brand">
            Open map
            <ArrowRight
              aria-hidden
              className="size-3.5 transition-transform group-hover:translate-x-0.5"
            />
          </span>
        </div>
      </Link>
    </Card>
  );
}

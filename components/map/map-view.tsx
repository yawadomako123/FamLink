'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import { BatteryLow, ChevronUp, MapPinOff, RefreshCw, X } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Alert, EmptyState } from '@/components/ui/feedback';
import { StatusDot, type PresenceStatus } from '@/components/ui/status-dot';
import { useFamilyLocations } from '@/hooks/useFamilyLocations';
import { locationFreshness, timeAgo } from '@/lib/time';
import { cn } from '@/lib/utils';
import type { MemberLocation, WithheldReason } from '@/lib/location/types';
import { isUsingFallbackStyle } from '@/lib/location/map-style';

/**
 * MapLibre touches `window` at import time and pulls in a large bundle, so the
 * map is loaded only in the browser and only for this route.
 */
const FamilyMap = dynamic(() => import('./family-map').then((m) => m.FamilyMap), {
  ssr: false,
  loading: () => <div className="absolute inset-0 skeleton" aria-hidden />,
});

const WITHHELD_COPY: Record<WithheldReason, string> = {
  'not-sharing': 'Not sharing location',
  paused: 'Location paused',
  hidden: 'Location hidden',
  'no-fix': 'No location yet',
};

export function MapView({
  familyId,
  familyName,
  memberNames,
  placeLabels,
}: {
  familyId: string;
  familyName: string;
  /** userId -> name, so withheld members can still be named in the list. */
  memberNames: Record<string, { name: string; image: string | null }>;
  /** userId -> place name, e.g. "Home". Only for members currently inside one. */
  placeLabels: Record<string, string>;
}) {
  const { locations, withheld, loading, error, degraded, refresh } =
    useFamilyLocations(familyId);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = React.useState(false);

  const selected = locations.find((l) => l.userId === selectedId) ?? null;

  const handleSelect = React.useCallback((userId: string | null) => {
    setSelectedId(userId);
    setSheetOpen(false);
  }, []);

  const sharingCount = locations.length;
  const totalCount = sharingCount + withheld.length;

  return (
    <div className="flex-1 min-h-0 flex flex-col md:flex-row">
      {/* ------------------------------------------------------------ map -- */}
      <div className="relative flex-1 min-h-0">
        {error && !degraded ? (
          <div className="absolute inset-0 grid place-items-center px-6">
            <div className="text-center max-w-xs">
              <MapPinOff aria-hidden className="size-8 text-subtle mx-auto" />
              <p className="text-sm font-medium text-fg mt-3">Unable to load the map</p>
              <p className="text-xs text-muted mt-1 leading-relaxed">{error}</p>
              <Button size="sm" variant="secondary" className="mt-4" onClick={refresh}>
                <RefreshCw aria-hidden className="size-3.5" />
                Try again
              </Button>
            </div>
          </div>
        ) : (
          <FamilyMap
            locations={locations}
            selectedUserId={selectedId}
            onSelect={handleSelect}
            className="absolute inset-0"
          />
        )}

        {/* Banners sit above the map rather than displacing it. */}
        <div className="absolute top-3 left-3 right-3 z-10 space-y-2 pointer-events-none [&>*]:pointer-events-auto">
          {degraded && (
            <Alert
              tone="warning"
              action={
                <Button size="sm" variant="ghost" onClick={refresh}>
                  Retry
                </Button>
              }
            >
              Connection lost. Showing the last positions we received.
            </Alert>
          )}

          {!loading && sharingCount === 0 && totalCount > 0 && (
            <Alert tone="info">
              Nobody in {familyName} is sharing their location right now.
            </Alert>
          )}
        </div>

        {isUsingFallbackStyle() && (
          <p className="absolute bottom-1.5 left-2 z-10 text-[10px] text-white/80 bg-black/45 px-1.5 py-0.5 rounded pointer-events-none">
            Development tiles — configure NEXT_PUBLIC_MAP_STYLE_URL for production
          </p>
        )}

        {/* Mobile: a pull-up list of members. */}
        <button
          type="button"
          onClick={() => setSheetOpen((v) => !v)}
          className="md:hidden absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 h-10 px-4 rounded-full bg-card border border-line shadow-lift text-sm font-medium"
        >
          <ChevronUp
            aria-hidden
            className={cn('size-4 transition-transform', sheetOpen && 'rotate-180')}
          />
          {sharingCount} of {totalCount} sharing
        </button>
      </div>

      {/* -------------------------------------------------------- members -- */}
      <aside
        className={cn(
          'bg-card border-line md:w-80 md:shrink-0 md:border-l md:static md:translate-y-0',
          'max-md:absolute max-md:inset-x-0 max-md:bottom-0 max-md:z-20 max-md:rounded-t-3xl max-md:border-t',
          'max-md:shadow-lift max-md:transition-transform max-md:duration-300 max-md:ease-out-soft',
          'max-md:max-h-[60vh] max-md:overflow-y-auto max-md:pb-safe',
          sheetOpen ? 'max-md:translate-y-0' : 'max-md:translate-y-full',
        )}
        aria-label="Family members"
      >
        <div className="sticky top-0 bg-card px-5 py-4 border-b border-line flex items-center justify-between">
          <div>
            <p className="font-semibold text-fg">{familyName}</p>
            <p className="text-xs text-muted mt-0.5">
              {sharingCount} of {totalCount} sharing
            </p>
          </div>
          <button
            type="button"
            onClick={() => setSheetOpen(false)}
            className="md:hidden size-8 rounded-lg flex items-center justify-center text-subtle hover:text-fg"
            aria-label="Close member list"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>

        {loading ? (
          <div className="p-5 space-y-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="skeleton size-10 rounded-full" />
                <div className="flex-1 space-y-2">
                  <div className="skeleton h-3.5 w-24 rounded" />
                  <div className="skeleton h-3 w-16 rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : totalCount === 0 ? (
          <EmptyState
            icon={MapPinOff}
            title="Nobody here yet"
            description="Invite your family, then everyone who opts in will appear on this map."
          />
        ) : (
          <ul className="divide-y divide-line">
            {locations.map((location) => (
              <MemberRow
                key={location.userId}
                location={location}
                placeLabel={placeLabels[location.userId]}
                selected={location.userId === selectedId}
                onSelect={() => handleSelect(location.userId)}
              />
            ))}

            {withheld.map((entry) => {
              const person = memberNames[entry.userId];
              if (!person) return null;

              return (
                <li key={entry.userId} className="flex items-center gap-3 px-5 py-3.5 opacity-70">
                  <Avatar
                    name={person.name}
                    userId={entry.userId}
                    image={person.image}
                    size="md"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-fg truncate">{person.name}</p>
                    <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
                      <StatusDot status={entry.reason === 'paused' ? 'paused' : 'offline'} />
                      <span className="text-xs text-muted truncate">{WITHHELD_COPY[entry.reason]}</span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </aside>

      {/* --------------------------------------------------------- detail -- */}
      {selected && (
        <MemberDetail
          location={selected}
          placeLabel={placeLabels[selected.userId]}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function MemberRow({
  location,
  placeLabel,
  selected,
  onSelect,
}: {
  location: MemberLocation;
  placeLabel?: string | undefined;
  selected: boolean;
  onSelect: () => void;
}) {
  const freshness = locationFreshness(location.recordedAt);
  const status: PresenceStatus = freshness.state === 'live' ? 'sharing' : 'stale';

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
        className={cn(
          'w-full flex items-center gap-3 px-5 py-3.5 text-left transition-colors',
          selected ? 'bg-tint-brand' : 'hover:bg-raised',
        )}
      >
        <Avatar name={location.name} userId={location.userId} image={location.image} size="md" />

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-fg truncate">{location.name}</p>
          <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
            <StatusDot status={status} />
            <span className="text-xs text-muted truncate">
              {/*
                A place name reads better than coordinates, but it must not
                imply currency the fix does not have, so freshness still
                qualifies it.
              */}
              {placeLabel ? `At ${placeLabel} · ${freshness.label}` : freshness.label}
            </span>
          </div>
        </div>

        {location.batteryPercentage !== null && (
          <span
            className={cn(
              'flex items-center gap-1 text-xs tabular-nums',
              location.batteryPercentage <= 15 ? 'text-danger-600' : 'text-muted',
            )}
          >
            {location.batteryPercentage <= 15 && <BatteryLow aria-hidden className="size-3.5" />}
            {location.batteryPercentage}%
          </span>
        )}
      </button>
    </li>
  );
}

function MemberDetail({
  location,
  placeLabel,
  onClose,
}: {
  location: MemberLocation;
  placeLabel?: string | undefined;
  onClose: () => void;
}) {
  const freshness = locationFreshness(location.recordedAt);

  return (
    <div className="absolute bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-30 w-[calc(100%-2rem)] max-w-sm">
      <div className="bg-card border border-line rounded-2xl shadow-lift p-4">
        <div className="flex items-start gap-3">
          <Avatar name={location.name} userId={location.userId} image={location.image} size="lg" />

          <div className="flex-1 min-w-0">
            <p className="font-semibold text-fg truncate">{location.name}</p>

            {placeLabel && (
              <p className="text-sm text-fg mt-0.5">At {placeLabel}</p>
            )}

            {/*
              Freshness is stated in words, not implied. A position from 27
              minutes ago says so rather than sitting silently on the map as
              though it were current.
            */}
            <p
              className={cn(
                'text-sm mt-0.5',
                freshness.state === 'live' ? 'text-on-tint-brand' : 'text-muted',
              )}
            >
              {freshness.state === 'live' ? 'Live now' : freshness.label}
            </p>

            <p className="text-xs text-subtle mt-1.5 tabular-nums">
              {location.latitude.toFixed(4)}, {location.longitude.toFixed(4)}
              {location.accuracy != null && ` · ±${Math.round(location.accuracy)}m`}
            </p>

            <p className="text-xs text-subtle mt-0.5">Updated {timeAgo(location.recordedAt)}</p>

            {location.batteryPercentage !== null && (
              <p className="text-xs text-subtle mt-0.5">
                Battery {location.batteryPercentage}%
                {location.isCharging ? ' · charging' : ''}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close details"
            className="size-8 shrink-0 rounded-lg flex items-center justify-center text-subtle hover:text-fg hover:bg-raised transition-colors"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

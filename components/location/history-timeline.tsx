'use client';

import * as React from 'react';
import { ChevronLeft, ChevronRight, MapPin, Route } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, EmptyState, Skeleton } from '@/components/ui/feedback';
import { api, errorMessage } from '@/lib/api/client';
import { distanceMetres } from '@/lib/location/geo';
import { formatClock, formatDayLabel } from '@/lib/time';

interface HistoryPoint {
  id: number;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  recordedAt: string;
}

/**
 * A day of the viewer's own movements.
 *
 * Raw fixes are grouped into "stays" — clusters where the position barely
 * changed — because a list of every ping is unreadable. A stay is what a person
 * actually recognises: "you were around here from 9:42 to 11:15".
 */
export function HistoryTimeline({ familyId }: { familyId: string }) {
  const [dayOffset, setDayOffset] = React.useState(0);

  const date = React.useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - dayOffset);
    return d;
  }, [dayOffset]);

  const isoDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;

  /*
   * The loaded result is tagged with the query it answers. Loading is then
   * derived by comparing that tag with the current query, rather than being a
   * separate flag an effect has to set synchronously before every fetch.
   */
  const queryKey = `${familyId}|${isoDate}`;
  const [result, setResult] = React.useState<{
    key: string;
    points?: HistoryPoint[];
    error?: string;
  } | null>(null);

  const loading = result?.key !== queryKey;
  const error = result?.key === queryKey ? result.error : undefined;
  const points = result?.key === queryKey ? result.points : undefined;

  React.useEffect(() => {
    let cancelled = false;

    // The server buckets days in the viewer's timezone, not its own.
    const params = new URLSearchParams({
      date: isoDate,
      timezoneOffset: String(new Date().getTimezoneOffset()),
    });

    api
      .get<{ points: HistoryPoint[] }>(`/api/v1/families/${familyId}/history?${params}`)
      .then((data) => {
        if (!cancelled) setResult({ key: queryKey, points: data.points });
      })
      .catch((err) => {
        if (!cancelled) setResult({ key: queryKey, error: errorMessage(err) });
      });

    return () => {
      cancelled = true;
    };
  }, [familyId, isoDate, queryKey]);

  const stays = React.useMemo(() => (points ? groupIntoStays(points) : []), [points]);

  return (
    <Card>
      <CardHeader className="flex items-center justify-between gap-2">
        <CardTitle>{formatDayLabel(date)}</CardTitle>

        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            aria-label="Previous day"
            onClick={() => setDayOffset((d) => d + 1)}
          >
            <ChevronLeft aria-hidden className="size-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Next day"
            disabled={dayOffset === 0}
            onClick={() => setDayOffset((d) => Math.max(0, d - 1))}
          >
            <ChevronRight aria-hidden className="size-4" />
          </Button>
        </div>
      </CardHeader>

      {error && (
        <div className="px-5 pb-5">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      {loading && (
        <div className="px-5 pb-5 space-y-3 border-t border-line pt-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex gap-3">
              <Skeleton className="size-9 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="h-3 w-20" />
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && !error && stays.length === 0 && (
        <EmptyState
          icon={Route}
          title="Nothing recorded"
          description={
            dayOffset === 0
              ? "No locations yet today. History fills in while sharing is on and FamLink is open."
              : 'No locations were recorded on this day.'
          }
          className="py-10"
        />
      )}

      {!loading && stays.length > 0 && (
        <ol className="border-t border-line divide-y divide-line">
          {stays.map((stay) => (
            <li key={stay.id} className="flex gap-3 px-5 py-3.5">
              <span className="mt-0.5 size-9 shrink-0 rounded-full bg-inset flex items-center justify-center">
                <MapPin aria-hidden className="size-4 text-subtle" />
              </span>

              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-fg tabular-nums">
                  {formatClock(stay.from)}
                  {stay.from !== stay.to && ` – ${formatClock(stay.to)}`}
                </p>
                <p className="text-xs text-muted mt-0.5">
                  {/*
                    Coordinates, not a place name: FamLink has no reverse
                    geocoder, and inventing a street name would be a fabrication.
                    Named places arrive with geofencing in phase 5.
                  */}
                  {stay.latitude.toFixed(4)}, {stay.longitude.toFixed(4)}
                  {stay.accuracy != null && ` · ±${Math.round(stay.accuracy)}m`}
                </p>
              </div>

              {stay.count > 1 && (
                <span className="text-xs text-subtle self-center tabular-nums">
                  {stay.count} fixes
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

/* -------------------------------------------------------------------------- */

interface Stay {
  id: number;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  from: string;
  to: string;
  count: number;
}

/** Consecutive fixes within this distance are treated as one stay. */
const STAY_RADIUS_M = 150;

/**
 * Collapses a day's fixes into stays.
 *
 * Input arrives newest-first from the API; this reverses it so the timeline
 * reads chronologically, which is how people think about a day.
 */
function groupIntoStays(points: HistoryPoint[]): Stay[] {
  const chronological = [...points].reverse();
  const stays: Stay[] = [];

  for (const point of chronological) {
    const last = stays[stays.length - 1];

    if (
      last &&
      distanceMetres(
        { latitude: last.latitude, longitude: last.longitude },
        { latitude: point.latitude, longitude: point.longitude },
      ) <= STAY_RADIUS_M
    ) {
      last.to = point.recordedAt;
      last.count += 1;
      // Keep the most precise fix as the stay's representative position.
      if (point.accuracy != null && (last.accuracy == null || point.accuracy < last.accuracy)) {
        last.latitude = point.latitude;
        last.longitude = point.longitude;
        last.accuracy = point.accuracy;
      }
      continue;
    }

    stays.push({
      id: point.id,
      latitude: point.latitude,
      longitude: point.longitude,
      accuracy: point.accuracy,
      from: point.recordedAt,
      to: point.recordedAt,
      count: 1,
    });
  }

  return stays;
}

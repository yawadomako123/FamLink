'use client';

import * as React from 'react';
import { api, errorMessage } from '@/lib/api/client';
import { useRealtime, type RealtimeStatus } from './useRealtime';
import type { FamilyLocationsResponse } from '@/lib/location/types';

/**
 * Keeps the family's positions current.
 *
 * Realtime-first, with polling as the safety net rather than the mechanism:
 * the SSE stream delivers an invalidation hint and this hook re-fetches
 * through the ordinary authorized endpoint, so the location visibility rule is
 * applied on every read.
 *
 * The poll interval adapts to the transport. While the stream is live a slow
 * poll only exists to catch a missed hint; when the stream has given up, the
 * poll becomes the primary mechanism and speeds up.
 */
const POLL_LIVE_MS = 120_000;
const POLL_FALLBACK_MS = 20_000;

export interface UseFamilyLocationsResult extends FamilyLocationsResponse {
  loading: boolean;
  error: string | null;
  /** True once a request has failed and we are showing older data. */
  degraded: boolean;
  realtimeStatus: RealtimeStatus;
  refresh: () => void;
}

export function useFamilyLocations(familyId: string): UseFamilyLocationsResult {
  const [data, setData] = React.useState<FamilyLocationsResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [nonce, setNonce] = React.useState(0);

  const refresh = React.useCallback(() => setNonce((n) => n + 1), []);

  const handleRealtimeEvent = React.useCallback(
    (type: string) => {
      // Members changing affects who may be visible, so both invalidate.
      if (type === 'locations' || type === 'members') refresh();
    },
    [refresh],
  );

  const { status: realtimeStatus } = useRealtime({
    familyId,
    onEvent: handleRealtimeEvent,
  });

  const pollInterval = realtimeStatus === 'live' ? POLL_LIVE_MS : POLL_FALLBACK_MS;

  React.useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const load = async () => {
      try {
        const result = await api.get<FamilyLocationsResponse>(
          `/api/v1/families/${familyId}/locations`,
        );
        if (cancelled) return;
        setData(result);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        // Keep the last known data on screen; the map labels its own
        // staleness, so older positions are safer than an empty map.
        setError(errorMessage(err));
      } finally {
        if (!cancelled) schedule();
      }
    };

    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        // A hidden tab costs battery and server queries for nothing anyone
        // can see.
        if (document.visibilityState === 'visible') void load();
        else schedule();
      }, pollInterval);
    };

    // Refresh immediately when the tab returns, rather than waiting out an
    // interval that elapsed while hidden.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };

    void load();
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [familyId, nonce, pollInterval]);

  return {
    locations: data?.locations ?? [],
    withheld: data?.withheld ?? [],
    loading: data === null && error === null,
    error,
    degraded: data !== null && error !== null,
    realtimeStatus,
    refresh,
  };
}

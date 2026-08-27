'use client';

import * as React from 'react';
import { api, errorMessage } from '@/lib/api/client';
import type { FamilyLocationsResponse } from '@/lib/location/types';

/**
 * Keeps the family's positions current.
 *
 * Polls for now. Phase 6 replaces the transport with a Server-Sent Events
 * stream backed by Postgres LISTEN/NOTIFY — this hook's shape is the seam for
 * that swap, so the map and member list will not change when it happens.
 *
 * Polling pauses while the tab is hidden: a background tab that keeps asking
 * costs the user battery and the server queries, and produces nothing anyone
 * can see.
 */
const POLL_INTERVAL_MS = 20_000;

export interface UseFamilyLocationsResult extends FamilyLocationsResponse {
  loading: boolean;
  error: string | null;
  /** True once a request has failed and we are showing older data. */
  degraded: boolean;
  refresh: () => void;
}

export function useFamilyLocations(familyId: string): UseFamilyLocationsResult {
  const [data, setData] = React.useState<FamilyLocationsResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [nonce, setNonce] = React.useState(0);

  const refresh = React.useCallback(() => setNonce((n) => n + 1), []);

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
        // Keep the last known data on screen; the map labels its own staleness,
        // so showing older positions is safe and better than an empty map.
        setError(errorMessage(err));
      } finally {
        if (!cancelled) schedule();
      }
    };

    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (document.visibilityState === 'visible') void load();
        else schedule();
      }, POLL_INTERVAL_MS);
    };

    // Refresh immediately when the tab is brought back, rather than waiting
    // out the remainder of an interval that elapsed while hidden.
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
  }, [familyId, nonce]);

  return {
    locations: data?.locations ?? [],
    withheld: data?.withheld ?? [],
    loading: data === null && error === null,
    error,
    degraded: data !== null && error !== null,
    refresh,
  };
}

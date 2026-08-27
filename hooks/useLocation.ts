'use client';

import * as React from 'react';
import { api, ApiClientError, NetworkError } from '@/lib/api/client';
import { shouldSendUpdate, THROTTLE, type ThrottleState } from '@/lib/location/geo';
import {
  ACQUISITION_TARGET_ACCURACY_M,
  ACQUISITION_WINDOW_MS,
  bestOf,
  describeAccuracy,
  judgeFix,
  smooth,
  type Fix,
} from '@/lib/location/accuracy';
import type { LocationSharingState } from '@/lib/db/schema';

/**
 * Browser location sharing.
 *
 * Two things this hook will not do:
 *
 *  1. It never starts watching until the user has explicitly chosen to share.
 *     There is no "warm up the permission prompt" path.
 *  2. It makes no claim to work in the background. A PWA loses geolocation the
 *     moment the page is hidden or closed, so the hook stops the watch when the
 *     document is hidden and reports that plainly through `backgroundLimited`
 *     rather than pretending updates continue.
 */

export type PermissionState = 'unknown' | 'prompt' | 'granted' | 'denied' | 'unsupported';

export type LocationProblem =
  | { kind: 'permission-denied'; message: string }
  | { kind: 'unavailable'; message: string }
  | { kind: 'timeout'; message: string }
  | { kind: 'inaccurate'; message: string }
  | { kind: 'network'; message: string }
  | { kind: 'rejected'; message: string };

export interface UseLocationResult {
  state: LocationSharingState;
  permission: PermissionState;
  /** The most recent fix this device produced, whether or not it was sent. */
  lastFix: { latitude: number; longitude: number; accuracy: number | null; at: number } | null;
  /** When a position was last accepted by the server. */
  lastSentAt: number | null;
  problem: LocationProblem | null;
  /** True while the watch is suspended because the page is hidden. */
  backgroundLimited: boolean;
  pending: boolean;
  /** True while sampling for an initial high-quality fix. */
  acquiring: boolean;
  /** Plain-language description of the current fix's precision. */
  accuracyLabel: string;
  startSharing: () => Promise<void>;
  pauseSharing: () => Promise<void>;
  stopSharing: () => Promise<void>;
  dismissProblem: () => void;
}

const GEO_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  // Generous: a cold GPS fix indoors can genuinely take this long.
  timeout: 30_000,
  /*
   * Never serve a cached position. A stale fix from the browser's cache is
   * indistinguishable from a current one once it reaches the family's map, and
   * FamLink's whole freshness story depends on timestamps meaning what they
   * say.
   */
  maximumAge: 0,
};

/** Sampling options while acquiring the first fix. */
const ACQUIRE_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: ACQUISITION_WINDOW_MS,
  maximumAge: 0,
};

export function useLocation({
  familyId,
  initialState,
}: {
  familyId: string;
  initialState: LocationSharingState;
}): UseLocationResult {
  const [state, setState] = React.useState<LocationSharingState>(initialState);
  const [permission, setPermission] = React.useState<PermissionState>('unknown');
  const [lastFix, setLastFix] = React.useState<UseLocationResult['lastFix']>(null);
  const [lastSentAt, setLastSentAt] = React.useState<number | null>(null);
  const [problem, setProblem] = React.useState<LocationProblem | null>(null);
  const [pending, setPending] = React.useState(false);
  const [acquiring, setAcquiring] = React.useState(false);

  // Page visibility is external state, so it is subscribed to rather than
  // mirrored into a useState from an effect.
  const visible = usePageVisible();
  const backgroundLimited = state === 'sharing' && !visible;

  const watchIdRef = React.useRef<number | null>(null);
  const throttleRef = React.useRef<ThrottleState>({ lastSentAt: null, lastPosition: null });
  /** The best fix accepted so far, after filtering and smoothing. */
  const bestFixRef = React.useRef<Fix | null>(null);
  // Guards against overlapping posts when fixes arrive faster than the network.
  const inFlightRef = React.useRef(false);

  /* ---------------------------------------------------------------- probe -- */

  React.useEffect(() => {
    let status: PermissionStatus | null = null;
    let cancelled = false;

    const onChange = () => {
      if (!status || cancelled) return;
      setPermission(status.state as PermissionState);

      // The user can revoke permission from browser settings while sharing is
      // on. Reflect that immediately instead of silently sending nothing.
      if (status.state === 'denied') {
        setProblem({
          kind: 'permission-denied',
          message:
            'Location access was turned off in your browser settings. FamLink has stopped sharing your location.',
        });
      }
    };

    // Deferred to a microtask so support detection and the permission query
    // resolve on the same path, and neither sets state synchronously during
    // the effect.
    void Promise.resolve()
      .then(async () => {
        if (cancelled) return;

        if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
          setPermission('unsupported');
          return;
        }

        // Firefox has no Permissions API entry for geolocation; the prompt is
        // the only way to learn the answer there.
        if (!navigator.permissions?.query) {
          setPermission('unknown');
          return;
        }

        const result = await navigator.permissions.query({ name: 'geolocation' });
        if (cancelled) return;

        status = result;
        setPermission(result.state as PermissionState);
        result.addEventListener('change', onChange);
      })
      .catch(() => {
        if (!cancelled) setPermission('unknown');
      });

    return () => {
      cancelled = true;
      status?.removeEventListener('change', onChange);
    };
  }, []);

  /* ----------------------------------------------------------- send a fix -- */

  const send = React.useCallback(
    async (fix: Fix) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;

      const { latitude, longitude, accuracy } = fix;

      try {
        await api.post('/api/v1/locations', {
          familyId,
          latitude,
          longitude,
          ...(accuracy !== null ? { accuracy } : {}),
          recordedAt: new Date(fix.timestamp).toISOString(),
          battery: await readBattery(),
        });

        const now = Date.now();
        throttleRef.current = { lastSentAt: now, lastPosition: { latitude, longitude } };
        setLastSentAt(now);
        setProblem(null);
      } catch (error) {
        if (error instanceof NetworkError) {
          // Transient. Keep watching; the next accepted fix clears this.
          setProblem({
            kind: 'network',
            message: "We couldn't reach FamLink. Your location will update when you're back online.",
          });
        } else if (error instanceof ApiClientError && error.status === 403) {
          // The server says sharing is off for this family — trust it and stop.
          setState('off');
          setProblem({
            kind: 'rejected',
            message: 'Location sharing was switched off for this family.',
          });
        } else if (!(error instanceof ApiClientError && error.status === 429)) {
          setProblem({
            kind: 'rejected',
            message: 'We could not save your location. We will try again shortly.',
          });
        }
      } finally {
        inFlightRef.current = false;
      }
    },
    [familyId],
  );

  const onPosition = React.useCallback(
    (position: GeolocationPosition) => {
      const raw: Fix = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        timestamp: position.timestamp,
      };

      /*
       * Filter before doing anything else. A single bad fix can place somebody
       * a suburb away, and once that reaches the family's map the damage is
       * done — better to drop it and wait for the next.
       */
      const verdict = judgeFix(raw, bestFixRef.current);

      if (!verdict.accept) {
        if (verdict.reason === 'unusable-accuracy') {
          setProblem({
            kind: 'inaccurate',
            message: `Your device's location is only accurate to about ${Math.round(
              raw.accuracy ?? 0,
            )}m right now, so it hasn't been shared. This usually improves outdoors.`,
          });
        }
        // Every other rejection is routine noise, not worth telling anyone.
        return;
      }

      // Smooth against the previous accepted fix to damp stationary jitter.
      const fix = smooth(raw, bestFixRef.current);
      bestFixRef.current = fix;

      setLastFix({
        latitude: fix.latitude,
        longitude: fix.longitude,
        accuracy: fix.accuracy,
        at: fix.timestamp,
      });

      const decision = shouldSendUpdate(
        { latitude: fix.latitude, longitude: fix.longitude, accuracy: fix.accuracy ?? undefined },
        throttleRef.current,
        Date.now(),
      );

      if (decision.send) void send(fix);
    },
    [send],
  );

  const onError = React.useCallback((error: GeolocationPositionError) => {
    switch (error.code) {
      case error.PERMISSION_DENIED:
        setPermission('denied');
        setState('off');
        setProblem({
          kind: 'permission-denied',
          message:
            'Location permission was denied. To share your location, allow location access for this site in your browser settings.',
        });
        break;
      case error.POSITION_UNAVAILABLE:
        setProblem({
          kind: 'unavailable',
          message:
            "Your device couldn't determine its location. This can happen indoors or with location services switched off.",
        });
        break;
      case error.TIMEOUT:
        setProblem({
          kind: 'timeout',
          message: 'Getting a location fix is taking longer than usual. Still trying…',
        });
        break;
      default:
        setProblem({ kind: 'unavailable', message: 'Location is unavailable right now.' });
    }
  }, []);

  /* ------------------------------------------------------------- the watch -- */

  const stopWatch = React.useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  }, []);

  const startWatch = React.useCallback(() => {
    if (watchIdRef.current !== null) return;
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return;

    watchIdRef.current = navigator.geolocation.watchPosition(onPosition, onError, GEO_OPTIONS);
  }, [onPosition, onError]);

  // Only watch while actively sharing AND the page is visible. A hidden page
  // gets throttled or suspended by the browser, so continuing to hold the watch
  // would burn battery while producing nothing useful.
  React.useEffect(() => {
    if (state === 'sharing' && visible) {
      startWatch();
    } else {
      stopWatch();
    }

    return stopWatch;
  }, [state, visible, startWatch, stopWatch]);

  /* ------------------------------------------------------------- controls -- */

  const applyState = React.useCallback(
    async (next: LocationSharingState) => {
      setPending(true);
      const previous = state;
      // Optimistic, so the switch responds instantly; reverted on failure.
      setState(next);

      try {
        await api.patch(`/api/v1/families/${familyId}/sharing`, { state: next });

        if (next !== 'sharing') {
          throttleRef.current = { lastSentAt: null, lastPosition: null };
          setLastSentAt(null);
        }
        setProblem(null);
      } catch (error) {
        setState(previous);
        setProblem({
          kind: 'network',
          message:
            error instanceof NetworkError
              ? "We couldn't reach FamLink. Your sharing setting hasn't changed."
              : 'We could not update your sharing setting. Please try again.',
        });
      } finally {
        setPending(false);
      }
    },
    [familyId, state],
  );

  const startSharing = React.useCallback(async () => {
    if (permission === 'unsupported') {
      setProblem({
        kind: 'unavailable',
        message: "This browser doesn't support location sharing.",
      });
      return;
    }

    setAcquiring(true);

    /*
     * Sample for a few seconds rather than taking the first fix.
     *
     * Browsers very often return a coarse network-derived position first and
     * refine it to a satellite fix seconds later. Taking the first one means
     * telling the family you are 500m from where you are. Sampling stops early
     * once a fix is good enough, so this rarely costs the full window.
     *
     * This is also what surfaces the permission prompt, so we never tell the
     * server we are sharing when the user is about to deny it.
     */
    const outcome = await new Promise<'granted' | 'denied' | 'unavailable'>((resolve) => {
      const samples: Fix[] = [];
      let settled = false;
      let watchId: number | null = null;

      const finish = (result: 'granted' | 'denied' | 'unavailable') => {
        if (settled) return;
        settled = true;
        if (watchId !== null) navigator.geolocation.clearWatch(watchId);

        const best = bestOf(samples);
        if (best) {
          bestFixRef.current = best;
          setLastFix({
            latitude: best.latitude,
            longitude: best.longitude,
            accuracy: best.accuracy,
            at: best.timestamp,
          });
        }

        resolve(samples.length > 0 ? 'granted' : result);
      };

      const timer = setTimeout(() => finish('granted'), ACQUISITION_WINDOW_MS);

      watchId = navigator.geolocation.watchPosition(
        (position) => {
          samples.push({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            timestamp: position.timestamp,
          });

          // Good enough — stop early rather than burning the whole window.
          if (position.coords.accuracy <= ACQUISITION_TARGET_ACCURACY_M) {
            clearTimeout(timer);
            finish('granted');
          }
        },
        (error) => {
          clearTimeout(timer);
          onError(error);
          finish(error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable');
        },
        ACQUIRE_OPTIONS,
      );
    });

    setAcquiring(false);

    if (outcome === 'denied') return;

    setPermission('granted');
    await applyState('sharing');

    // Send the acquired fix immediately so the family sees them straight away.
    if (bestFixRef.current) void send(bestFixRef.current);
  }, [permission, onError, applyState, send]);

  const pauseSharing = React.useCallback(() => applyState('paused'), [applyState]);
  const stopSharing = React.useCallback(() => applyState('off'), [applyState]);

  return {
    state,
    permission,
    lastFix,
    lastSentAt,
    problem,
    backgroundLimited,
    pending,
    acquiring,
    accuracyLabel: describeAccuracy(lastFix?.accuracy ?? null).label,
    startSharing,
    pauseSharing,
    stopSharing,
    dismissProblem: () => setProblem(null),
  };
}

/* -------------------------------------------------------------------------- */

/**
 * Whether the document is currently visible.
 *
 * useSyncExternalStore rather than an effect writing to state: visibility is
 * owned by the browser, and this keeps renders consistent with it without a
 * cascading update on every change.
 */
function usePageVisible(): boolean {
  return React.useSyncExternalStore(
    (onStoreChange) => {
      document.addEventListener('visibilitychange', onStoreChange);
      return () => document.removeEventListener('visibilitychange', onStoreChange);
    },
    () => document.visibilityState === 'visible',
    // Server snapshot: assume visible so markup matches the common case.
    () => true,
  );
}

interface BatteryLike {
  level: number;
  charging: boolean;
}

/**
 * Battery level, where the browser offers it.
 *
 * The Battery Status API is Chromium-only — Safari and Firefox removed it over
 * fingerprinting concerns — so this returns undefined far more often than not.
 * That is why battery is optional throughout the product rather than a field
 * the UI expects to be populated.
 */
async function readBattery(): Promise<{ percentage: number; isCharging: boolean } | undefined> {
  try {
    const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryLike> };
    if (typeof nav.getBattery !== 'function') return undefined;

    const battery = await nav.getBattery();
    return {
      percentage: Math.round(battery.level * 100),
      isCharging: battery.charging,
    };
  } catch {
    return undefined;
  }
}

export { THROTTLE };

'use client';

import * as React from 'react';
import { isRealtimeEvent, type RealtimeEvent, type RealtimeEventType } from '@/lib/realtime/events';

/**
 * Subscribes to a family's realtime event stream.
 *
 * Degrades in three steps rather than failing:
 *
 *   live     — SSE connected, updates arrive immediately.
 *   polling  — SSE unavailable or repeatedly failing; the caller falls back to
 *              its own interval refresh.
 *   offline  — the browser reports no connection at all.
 *
 * The status is surfaced so the UI can be honest about which one is in force.
 * Silently degrading from live to polling would leave someone believing the
 * map is current when it may be a minute stale.
 *
 * Events are invalidation hints, never data — see lib/realtime/events.ts.
 */

export type RealtimeStatus = 'connecting' | 'live' | 'reconnecting' | 'polling' | 'offline';

/** After this many consecutive failures, stop trying and let polling take over. */
const MAX_CONSECUTIVE_FAILURES = 3;

export interface UseRealtimeOptions {
  familyId: string | null;
  /**
   * The event itself is passed as well as its type, for the handful of events
   * that carry one — `emergency` names who raised it, `typing` names who is
   * composing. Everything else is a bare invalidation hint.
   */
  onEvent: (type: RealtimeEventType, event?: RealtimeEvent) => void;
  /** Set false to skip SSE entirely (e.g. the user has no family yet). */
  enabled?: boolean;
}

export function useRealtime({
  familyId,
  onEvent,
  enabled = true,
}: UseRealtimeOptions): { status: RealtimeStatus } {
  const [status, setStatus] = React.useState<RealtimeStatus>('connecting');
  const onEventRef = React.useRef(onEvent);

  // Keep the latest handler without tearing down the connection when the
  // caller re-renders with a new closure.
  React.useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  React.useEffect(() => {
    if (!enabled || !familyId) return;

    let source: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;
    let disposed = false;

    const close = () => {
      source?.close();
      source = null;
    };

    const connect = () => {
      if (disposed) return;

      // Support detection lives here rather than in the effect body so that
      // no state is set synchronously during the effect.
      if (typeof window === 'undefined' || typeof EventSource === 'undefined') {
        setStatus('polling');
        return;
      }

      if (!navigator.onLine) {
        setStatus('offline');
        return;
      }

      source = new EventSource(`/api/v1/families/${familyId}/stream`);

      source.addEventListener('open', () => {
        failures = 0;
        setStatus('live');
      });

      const handle = (type: RealtimeEventType) => (raw: MessageEvent) => {
        let parsed: RealtimeEvent | undefined;

        try {
          const candidate: unknown = JSON.parse(raw.data);
          if (isRealtimeEvent(candidate)) parsed = candidate;
        } catch {
          // A hint that will not parse is still a hint that something changed.
        }

        onEventRef.current(type, parsed);
      };

      for (const type of [
        'locations',
        'message',
        'notification',
        'emergency',
        'members',
        'call',
        'typing',
      ] as const) {
        source.addEventListener(type, handle(type));
      }

      /*
       * The server closes the stream before the platform's function timeout so
       * it is never killed mid-frame. This is an expected, healthy close —
       * reconnect immediately and do not count it as a failure.
       */
      source.addEventListener('cycle', () => {
        close();
        if (!disposed) connect();
      });

      // The server could not subscribe at all (e.g. no unpooled connection).
      // Retrying will not help; hand over to polling.
      source.addEventListener('unavailable', () => {
        close();
        setStatus('polling');
      });

      source.addEventListener('error', () => {
        close();
        if (disposed) return;

        failures += 1;

        if (failures >= MAX_CONSECUTIVE_FAILURES) {
          setStatus('polling');
          return;
        }

        setStatus('reconnecting');
        // Back off so a struggling server is not hammered.
        const delay = Math.min(1000 * 2 ** failures, 15_000);
        reconnectTimer = setTimeout(connect, delay);
      });
    };

    const onOnline = () => {
      failures = 0;
      close();
      connect();
    };

    const onOffline = () => {
      close();
      setStatus('offline');
    };

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    // Deferred to a microtask: connecting during the effect body would set
    // state synchronously and cascade a render.
    queueMicrotask(connect);

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      close();
    };
  }, [familyId, enabled]);

  return { status };
}

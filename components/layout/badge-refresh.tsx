'use client';

import * as React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useRealtime } from '@/hooks/useRealtime';

/**
 * Keeps the navigation badges honest while the app sits open.
 *
 * The unread counts are resolved server-side once per page render, so before
 * this the only way to see a new message was to navigate somewhere. Somebody
 * looking at the map while their family talked to them saw nothing at all.
 *
 * Refreshing the route re-runs the server components and with them the counts.
 * It is throttled because a burst of messages would otherwise mean a burst of
 * refreshes, and skipped entirely on the chat page, where the view already
 * streams its own messages and the unread count is zero by definition.
 */
const REFRESH_THROTTLE_MS = 4000;

export function BadgeRefresh({ familyId }: { familyId: string }) {
  const router = useRouter();
  const pathname = usePathname();

  // Read from a ref so the callback identity does not change per navigation,
  // which would otherwise tear down and rebuild the event stream.
  const pathRef = React.useRef(pathname);

  React.useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);

  const lastRefresh = React.useRef(0);
  const pending = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const onEvent = React.useCallback(
    (type: string) => {
      if (type !== 'message' && type !== 'notification') return;
      if (pathRef.current.startsWith('/chat')) return;

      const since = Date.now() - lastRefresh.current;

      if (since >= REFRESH_THROTTLE_MS) {
        lastRefresh.current = Date.now();
        router.refresh();
        return;
      }

      // Inside the window: coalesce into one trailing refresh rather than
      // dropping the event, so the last message of a burst still counts.
      if (pending.current) return;
      pending.current = setTimeout(() => {
        pending.current = null;
        lastRefresh.current = Date.now();
        router.refresh();
      }, REFRESH_THROTTLE_MS - since);
    },
    [router],
  );

  React.useEffect(
    () => () => {
      if (pending.current) clearTimeout(pending.current);
    },
    [],
  );

  useRealtime({ familyId, onEvent });

  return null;
}

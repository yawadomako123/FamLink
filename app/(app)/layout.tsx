import type { ReactNode } from 'react';
import { requireSession } from '@/lib/auth/session';

/**
 * Auth gate for every signed-in route.
 *
 * The chrome itself is not rendered here: pages compose <AppShell> so each can
 * set its own title and choose a scrolling or full-bleed content area (the map
 * needs the latter).
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  await requireSession();
  return <>{children}</>;
}

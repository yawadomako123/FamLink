'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { signOut } from '@/lib/auth/client';
import { BottomNav } from './bottom-nav';
import { Sidebar } from './sidebar';
import { TopBar, type TopBarUser } from './top-bar';
import { cn } from '@/lib/utils';

export interface AppShellProps {
  user: TopBarUser;
  familyName?: string | undefined;
  title?: string | undefined;
  alertCount?: number;
  unreadMessages?: number;
  /** Controls on the right of the header, e.g. the SOS button. */
  headerRight?: React.ReactNode;
  /**
   * Map-style pages manage their own scrolling and need the content area to be
   * a fixed-height flex child rather than a scrolling column.
   */
  fullBleed?: boolean;
  children: React.ReactNode;
}

/**
 * The authenticated chrome: sidebar on desktop, tab bar on mobile, header on
 * both. Pages render inside <main> and never draw navigation themselves.
 */
export function AppShell({
  user,
  familyName,
  title,
  alertCount = 0,
  unreadMessages = 0,
  headerRight,
  fullBleed = false,
  children,
}: AppShellProps) {
  const router = useRouter();

  const handleSignOut = React.useCallback(async () => {
    await signOut();
    router.push('/login');
    router.refresh();
  }, [router]);

  return (
    <div className="flex min-h-dvh bg-surface">
      <Sidebar
        familyName={familyName}
        alertCount={alertCount}
        unreadMessages={unreadMessages}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <TopBar
          user={user}
          title={title}
          right={headerRight}
          onSignOut={() => void handleSignOut()}
        />

        <main
          id="main"
          className={cn(
            'flex-1 min-h-0',
            fullBleed
              ? 'flex flex-col'
              : // Bottom padding clears the mobile tab bar plus the home indicator.
                'overflow-y-auto pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-0',
          )}
        >
          {children}
        </main>
      </div>

      <BottomNav alertCount={alertCount} />
    </div>
  );
}

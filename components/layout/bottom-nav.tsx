'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PRIMARY_NAV, isActivePath } from '@/lib/navigation';
import { cn } from '@/lib/utils';

/**
 * Mobile tab bar. Hidden from md upward, where the sidebar takes over.
 * Sits above the home indicator via pb-safe.
 */
export function BottomNav({
  alertCount = 0,
  unreadMessages = 0,
}: {
  alertCount?: number;
  unreadMessages?: number;
}) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main"
      className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-card/95 backdrop-blur-lg border-t border-line pb-safe"
    >
      <ul className="grid grid-cols-5">
        {PRIMARY_NAV.map((item) => {
          const active = isActivePath(pathname, item.href);
          const Icon = item.icon;
          /*
           * Chat badges here as well as in the sidebar. Without it a message
           * arriving while the app was open left no trace anywhere on a phone.
           */
          const count =
            item.href === '/alerts' ? alertCount : item.href === '/chat' ? unreadMessages : 0;
          const showBadge = count > 0;
          const badgeLabel =
            item.href === '/alerts' ? 'unread alerts' : 'unread messages';

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex flex-col items-center justify-center gap-1 py-2.5 min-h-14',
                  'transition-colors',
                  active ? 'text-brand-600' : 'text-subtle hover:text-muted',
                )}
              >
                <span className="relative">
                  <Icon aria-hidden className="size-5.5" strokeWidth={active ? 2.4 : 1.9} />
                  {showBadge && (
                    <span
                      aria-hidden
                      className="absolute -top-1 -right-1.5 min-w-4 h-4 px-1 rounded-full bg-danger-600 text-white text-[10px] font-bold flex items-center justify-center"
                    >
                      {count > 9 ? '9+' : count}
                    </span>
                  )}
                </span>
                <span className="text-[10px] font-medium leading-none">{item.label}</span>
                {showBadge && (
                  <span className="sr-only">
                    {count} {badgeLabel}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

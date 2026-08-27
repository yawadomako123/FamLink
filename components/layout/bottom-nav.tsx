'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PRIMARY_NAV, isActivePath } from '@/lib/navigation';
import { cn } from '@/lib/utils';

/**
 * Mobile tab bar. Hidden from md upward, where the sidebar takes over.
 * Sits above the home indicator via pb-safe.
 */
export function BottomNav({ alertCount = 0 }: { alertCount?: number }) {
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
          const showBadge = item.href === '/alerts' && alertCount > 0;

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
                      {alertCount > 9 ? '9+' : alertCount}
                    </span>
                  )}
                </span>
                <span className="text-[10px] font-medium leading-none">{item.label}</span>
                {showBadge && <span className="sr-only">{alertCount} unread alerts</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

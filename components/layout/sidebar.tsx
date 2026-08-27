'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV_ITEMS, isActivePath } from '@/lib/navigation';
import { cn } from '@/lib/utils';
import { Logo } from './logo';

/**
 * Desktop navigation rail. The primary items sit above a divider, with the
 * secondary destinations (chat, places, history) below it — on mobile those
 * are reached from the dashboard instead of crowding the tab bar.
 */
export function Sidebar({
  familyName,
  alertCount = 0,
  unreadMessages = 0,
}: {
  familyName?: string | undefined;
  alertCount?: number;
  unreadMessages?: number;
}) {
  const pathname = usePathname();
  const primary = NAV_ITEMS.filter((i) => i.primary && i.href !== '/profile');
  const secondary = NAV_ITEMS.filter((i) => !i.primary);

  const renderItem = (item: (typeof NAV_ITEMS)[number]) => {
    const active = isActivePath(pathname, item.href);
    const Icon = item.icon;
    const badge =
      item.href === '/alerts' ? alertCount : item.href === '/chat' ? unreadMessages : 0;

    return (
      <li key={item.href}>
        <Link
          href={item.href}
          aria-current={active ? 'page' : undefined}
          className={cn(
            'flex items-center gap-3 h-11 px-3 rounded-xl text-sm font-medium transition-colors',
            active ? 'bg-brand-50 text-brand-700' : 'text-muted hover:bg-raised hover:text-fg',
          )}
        >
          <Icon aria-hidden className="size-5" strokeWidth={active ? 2.3 : 1.9} />
          <span className="flex-1">{item.label}</span>
          {badge > 0 && (
            <span className="min-w-5 h-5 px-1.5 rounded-full bg-danger-600 text-white text-[11px] font-bold flex items-center justify-center">
              {badge > 99 ? '99+' : badge}
            </span>
          )}
        </Link>
      </li>
    );
  };

  return (
    <aside className="hidden md:flex flex-col w-60 shrink-0 border-r border-line bg-card">
      <div className="h-16 flex items-center px-5 border-b border-line">
        <Link href="/dashboard" className="rounded-lg">
          <Logo />
        </Link>
      </div>

      {familyName && (
        <div className="px-5 pt-4 pb-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-subtle">Family</p>
          <p className="text-sm font-medium text-fg truncate mt-0.5">{familyName}</p>
        </div>
      )}

      <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-2">
        <ul className="space-y-0.5">{primary.map(renderItem)}</ul>
        <hr className="my-3 border-line" />
        <ul className="space-y-0.5">{secondary.map(renderItem)}</ul>
      </nav>
    </aside>
  );
}

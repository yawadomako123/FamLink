'use client';

import Link from 'next/link';
import * as React from 'react';
import { ChevronDown, LogOut, Settings, User as UserIcon } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Logo } from './logo';
import { cn } from '@/lib/utils';

export interface TopBarUser {
  id: string;
  name: string;
  email: string;
  image?: string | null;
}

/**
 * App header. On mobile it carries the FamLink mark; on desktop the mark lives
 * in the sidebar and this bar is given over to the page title and account menu.
 */
export function TopBar({
  user,
  title,
  onSignOut,
  right,
}: {
  user: TopBarUser;
  title?: string | undefined;
  onSignOut: () => void;
  right?: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);

  // Dismiss on outside click and on Escape.
  React.useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <header className="sticky top-0 z-30 h-16 shrink-0 bg-card/95 backdrop-blur-lg border-b border-line pt-safe">
      <div className="h-16 flex items-center gap-3 px-4 md:px-6">
        <Link href="/dashboard" className="md:hidden rounded-lg">
          <Logo showWordmark={false} />
        </Link>

        {title && (
          <h1 className="text-[17px] font-semibold tracking-tight text-fg truncate">{title}</h1>
        )}

        <div className="flex-1" />

        {right}

        <div ref={menuRef} className="relative">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={open}
            className="flex items-center gap-1.5 rounded-full p-0.5 pr-1.5 hover:bg-raised transition-colors"
          >
            <Avatar name={user.name} userId={user.id} image={user.image} size="sm" />
            <ChevronDown
              aria-hidden
              className={cn('size-4 text-subtle transition-transform', open && 'rotate-180')}
            />
            <span className="sr-only">Account menu</span>
          </button>

          {open && (
            <div
              role="menu"
              className="absolute right-0 top-full mt-2 w-56 bg-card border border-line rounded-xl shadow-lift overflow-hidden"
            >
              <div className="px-3.5 py-3 border-b border-line">
                <p className="text-sm font-medium text-fg truncate">{user.name}</p>
                <p className="text-xs text-muted truncate">{user.email}</p>
              </div>
              <div className="p-1">
                <MenuLink href="/profile" icon={UserIcon} onSelect={() => setOpen(false)}>
                  Profile
                </MenuLink>
                <MenuLink href="/settings" icon={Settings} onSelect={() => setOpen(false)}>
                  Settings
                </MenuLink>
              </div>
              <div className="p-1 border-t border-line">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    onSignOut();
                  }}
                  className="w-full flex items-center gap-2.5 h-9 px-2.5 rounded-lg text-sm text-danger-600 hover:bg-tint-danger transition-colors"
                >
                  <LogOut aria-hidden className="size-4" />
                  Log out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function MenuLink({
  href,
  icon: Icon,
  children,
  onSelect,
}: {
  href: string;
  icon: React.ElementType;
  children: React.ReactNode;
  onSelect: () => void;
}) {
  return (
    <Link
      href={href}
      role="menuitem"
      onClick={onSelect}
      className="flex items-center gap-2.5 h-9 px-2.5 rounded-lg text-sm text-fg hover:bg-raised transition-colors"
    >
      <Icon aria-hidden className="size-4 text-muted" />
      {children}
    </Link>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BarChart3, Home, Users2, ShieldCheck } from 'lucide-react';
import { Logo } from '@/components/layout/logo';
import { getPlatformAdmin } from '@/lib/admin/guard';

export const metadata: Metadata = {
  title: { template: '%s · FamLink admin', default: 'FamLink admin' },
  // Nothing here should ever be indexed, linked to, or previewed.
  robots: { index: false, follow: false },
};

/**
 * The admin shell.
 *
 * `notFound()` rather than a redirect to login, and rather than a 403. A
 * signed-in member who wanders here should see what they would see for any
 * address that does not exist, because as far as they are concerned it does
 * not. Advertising the area to everybody who is not allowed into it buys
 * nothing and invites attention.
 *
 * Deliberately not the app shell: no bottom navigation, no family switcher, no
 * call manager. This is a different job for a different person, and dressing
 * it as FamLink-with-extra-pages is how somebody ends up thinking a number on
 * screen is about their own family.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await getPlatformAdmin();
  if (!admin) notFound();

  return (
    <div className="min-h-dvh bg-surface">
      <header className="sticky top-0 z-30 bg-card border-b border-line">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center gap-3">
          <Link href="/admin" className="shrink-0 rounded-lg">
            <Logo showWordmark={false} />
          </Link>

          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-1 rounded-md bg-tint-brand text-on-tint-brand shrink-0">
            <ShieldCheck aria-hidden className="size-3" />
            Admin
          </span>

          <nav aria-label="Admin" className="flex items-center gap-1 min-w-0 overflow-x-auto">
            <AdminLink href="/admin" icon={BarChart3}>
              Overview
            </AdminLink>
            <AdminLink href="/admin/users" icon={Users2}>
              People
            </AdminLink>
            <AdminLink href="/admin/families" icon={Home}>
              Families
            </AdminLink>
          </nav>

          <div className="flex-1" />

          <Link
            href="/dashboard"
            className="shrink-0 text-xs text-muted hover:text-fg transition-colors"
          >
            Back to app
          </Link>
        </div>
      </header>

      <main id="main" className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        {children}
      </main>
    </div>
  );
}

function AdminLink({
  href,
  icon: Icon,
  children,
}: {
  href: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="shrink-0 inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-sm font-medium text-muted hover:text-fg hover:bg-raised transition-colors"
    >
      <Icon aria-hidden className="size-4" />
      {children}
    </Link>
  );
}

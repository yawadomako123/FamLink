import type { Metadata } from 'next';
import { CloudOff } from 'lucide-react';
import { Logo } from '@/components/layout/logo';

export const metadata: Metadata = { title: 'Offline' };

/**
 * Cached by the service worker at install and served for any navigation that
 * fails while offline. Says only what is true: we cannot reach FamLink, and
 * whatever was on screen may be out of date.
 */
export default function OfflinePage() {
  return (
    <main id="main" className="min-h-dvh flex flex-col items-center justify-center px-6 text-center">
      <Logo className="mb-10" />

      <div className="size-14 rounded-2xl bg-inset flex items-center justify-center">
        <CloudOff aria-hidden className="size-7 text-subtle" />
      </div>

      <h1 className="text-xl font-semibold tracking-tight mt-5">You&rsquo;re offline</h1>
      <p className="text-sm text-muted mt-2 max-w-xs leading-relaxed text-balance">
        FamLink needs a connection to show where your family is. Anything you saw before you went
        offline may now be out of date.
      </p>

      <p className="text-xs text-subtle mt-8">This page will work again once you reconnect.</p>
    </main>
  );
}

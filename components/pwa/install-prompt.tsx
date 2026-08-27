'use client';

import * as React from 'react';
import { Download, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Home-screen install prompt.
 *
 * Only rendered when the browser actually offers one. Chromium fires
 * `beforeinstallprompt`; Safari never does, so iOS users see nothing here
 * rather than a button that cannot work — a dead "Install" control is worse
 * than no control.
 *
 * Dismissal is remembered in localStorage so this is asked once, not on every
 * visit. It is a per-device convenience, which is exactly what localStorage is
 * for, and losing it costs nothing.
 */

const DISMISSED_KEY = 'famlink:install-dismissed';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function InstallPrompt() {
  const [deferred, setDeferred] = React.useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    // Already installed — nothing to offer.
    if (window.matchMedia('(display-mode: standalone)').matches) return;

    let dismissed = false;
    try {
      dismissed = localStorage.getItem(DISMISSED_KEY) === '1';
    } catch {
      // Private mode or blocked storage: treat as not dismissed.
    }
    if (dismissed) return;

    const onPrompt = (event: Event) => {
      // Stop Chrome's own mini-infobar so there is exactly one ask.
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
      setVisible(true);
    };

    const onInstalled = () => setVisible(false);

    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const dismiss = React.useCallback(() => {
    setVisible(false);
    try {
      localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      // Not being able to remember the dismissal is not worth surfacing.
    }
  }, []);

  const install = React.useCallback(async () => {
    if (!deferred) return;

    await deferred.prompt();
    await deferred.userChoice;

    // The event can only be used once, whatever the outcome.
    setDeferred(null);
    setVisible(false);
  }, [deferred]);

  if (!visible || !deferred) return null;

  return (
    <div
      role="complementary"
      aria-label="Install FamLink"
      className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] md:bottom-4 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-2rem)] max-w-sm"
    >
      <div className="bg-card border border-line rounded-2xl shadow-lift p-4 flex items-start gap-3">
        <span className="size-10 shrink-0 rounded-xl bg-tint-brand flex items-center justify-center">
          <Download aria-hidden className="size-5 text-on-tint-brand" />
        </span>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-fg">Add FamLink to your home screen</p>
          <p className="text-xs text-muted mt-0.5 leading-relaxed">
            Opens like an app and starts faster. Location sharing still only works while
            FamLink is open.
          </p>

          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={() => void install()}>
              Install
            </Button>
            <Button size="sm" variant="ghost" onClick={dismiss}>
              Not now
            </Button>
          </div>
        </div>

        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss install prompt"
          className="size-7 shrink-0 rounded-lg flex items-center justify-center text-subtle hover:text-fg hover:bg-raised transition-colors"
        >
          <X aria-hidden className="size-4" />
        </button>
      </div>
    </div>
  );
}

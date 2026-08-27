'use client';

import * as React from 'react';
import { Download, Share, SquarePlus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/layout/logo';
import {
  canOfferInstall,
  detectPlatform,
  rememberDismissal,
  wasRecentlyDismissed,
  type InstallPlatform,
} from '@/lib/pwa/install';
import { cn } from '@/lib/utils';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * Install banner.
 *
 * Shows a real prompt where the browser offers one, and step-by-step
 * instructions on iOS Safari where it does not — Apple has never implemented
 * `beforeinstallprompt`, and there is no API to trigger the Add to Home Screen
 * flow, so instructions are the only honest option.
 *
 * Every branch says what installing actually gets you, and repeats the
 * background-location limit. Installing is exactly when somebody is most
 * likely to assume the app now tracks them in the background, and it does not.
 */
export function InstallPrompt() {
  const [deferred, setDeferred] = React.useState<BeforeInstallPromptEvent | null>(null);
  const [platform, setPlatform] = React.useState<InstallPlatform>('unsupported');
  const [dismissed, setDismissed] = React.useState(true);
  const [showIosSteps, setShowIosSteps] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;

    const evaluate = (withPrompt: boolean) => {
      if (cancelled) return;
      setPlatform(detectPlatform(withPrompt));
      setDismissed(wasRecentlyDismissed());
    };

    const onPrompt = (event: Event) => {
      // Suppress Chrome's own mini-infobar so there is exactly one ask.
      event.preventDefault();
      if (cancelled) return;
      setDeferred(event as BeforeInstallPromptEvent);
      evaluate(true);
    };

    const onInstalled = () => {
      if (cancelled) return;
      setDeferred(null);
      setPlatform('installed');
    };

    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);

    // Deferred so nothing is set synchronously during the effect. iOS never
    // fires the event, so detection cannot wait for it.
    queueMicrotask(() => evaluate(false));

    return () => {
      cancelled = true;
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const dismiss = React.useCallback(() => {
    setDismissed(true);
    setShowIosSteps(false);
    rememberDismissal();
  }, []);

  const install = React.useCallback(async () => {
    if (!deferred) return;

    await deferred.prompt();
    const { outcome } = await deferred.userChoice;

    // The event is single-use whatever the outcome.
    setDeferred(null);
    if (outcome === 'dismissed') dismiss();
  }, [deferred, dismiss]);

  if (dismissed || !canOfferInstall(platform)) return null;

  return (
    <div
      role="complementary"
      aria-label="Install FamLink"
      className={cn(
        'fixed z-40 left-1/2 -translate-x-1/2 w-[calc(100%-1.5rem)] max-w-md',
        // Clear of the mobile tab bar, which is fixed to the bottom.
        'bottom-[calc(4.5rem+env(safe-area-inset-bottom))] md:bottom-4',
      )}
    >
      <div className="bg-card border border-line rounded-2xl shadow-lift overflow-hidden">
        <div className="flex items-start gap-3 p-4">
          <Logo showWordmark={false} className="[&_svg]:size-11 shrink-0" />

          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-fg">Install FamLink on your phone</p>
            <p className="text-xs text-muted mt-0.5 leading-relaxed">
              Opens like a real app, starts faster, and keeps you signed in.
            </p>
          </div>

          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss"
            className="size-7 shrink-0 rounded-lg flex items-center justify-center text-subtle hover:text-fg hover:bg-raised transition-colors"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>

        {/* ------------------------------------------------ Chromium prompt -- */}
        {platform === 'prompt' && (
          <div className="px-4 pb-4 flex gap-2">
            <Button size="sm" fullWidth onClick={() => void install()}>
              <Download aria-hidden className="size-4" />
              Install
            </Button>
            <Button size="sm" variant="ghost" onClick={dismiss}>
              Not now
            </Button>
          </div>
        )}

        {/* ---------------------------------------------------- iOS Safari -- */}
        {platform === 'ios-safari' && (
          <div className="px-4 pb-4">
            {showIosSteps ? (
              <ol className="space-y-2.5 text-sm">
                <IosStep n={1} icon={Share}>
                  Tap the <strong className="font-semibold">Share</strong> button in
                  Safari&rsquo;s toolbar.
                </IosStep>
                <IosStep n={2} icon={SquarePlus}>
                  Scroll down and choose{' '}
                  <strong className="font-semibold">Add to Home Screen</strong>.
                </IosStep>
                <IosStep n={3}>
                  Tap <strong className="font-semibold">Add</strong>. FamLink will appear
                  with your other apps.
                </IosStep>
              </ol>
            ) : (
              <Button size="sm" fullWidth onClick={() => setShowIosSteps(true)}>
                <Share aria-hidden className="size-4" />
                Show me how
              </Button>
            )}
          </div>
        )}

        {/* ----------------------------------------- iOS, wrong browser ----- */}
        {platform === 'ios-other' && (
          <div className="px-4 pb-4">
            <p className="text-xs text-muted leading-relaxed">
              {/* Sending them to "tap Share" here would be wrong: the menu item
                  only exists in Safari. */}
              On iPhone and iPad, only <strong className="font-semibold">Safari</strong> can
              add apps to the home screen. Open FamLink in Safari, then tap Share → Add to
              Home Screen.
            </p>
          </div>
        )}

        <p className="px-4 py-2.5 bg-inset text-[11px] text-subtle leading-relaxed border-t border-line">
          Installing doesn&rsquo;t change how location works — FamLink still only updates
          your location while it&rsquo;s open.
        </p>
      </div>
    </div>
  );
}

function IosStep({
  n,
  icon: Icon,
  children,
}: {
  n: number;
  icon?: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-2.5">
      <span className="size-5 shrink-0 rounded-full bg-tint-brand text-on-tint-brand text-[11px] font-bold grid place-items-center mt-0.5">
        {n}
      </span>
      <span className="text-muted leading-relaxed">
        {children}
        {Icon && (
          <Icon
            aria-hidden
            className="inline-block size-3.5 ml-1 -mt-0.5 text-on-tint-brand"
          />
        )}
      </span>
    </li>
  );
}

'use client';

import * as React from 'react';
import { BellRing, Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { registerForPush } from '@/lib/firebase/client';

/**
 * Turning on push for this device, deliberately.
 *
 * FamLink used to ask for notification permission two seconds after the app
 * first loaded, before anybody had seen what it was for. A browser remembers a
 * refusal more or less for ever, so a prompt nobody understood yet was the
 * fastest way to lose push on that device permanently — and push is how an SOS
 * reaches somebody whose phone is in their pocket.
 *
 * So nothing is asked for until this is pressed. The cost is that push is off
 * until somebody turns it on; the alternative was pushing people into a "no"
 * they could not easily take back.
 *
 * Per device, not per account, which is why the state is read from the browser
 * rather than the server.
 */
export function EnableNotifications() {
  /*
   * The browser owns this, so it is subscribed to rather than copied into
   * state by an effect. The server has no Notification at all, so its
   * snapshot is `checking` and the first client paint agrees with the markup.
   */
  const permission = React.useSyncExternalStore(
    () => () => {},
    () => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission),
    () => 'checking',
  );

  /** Set while asking, and after, since the browser value is read once. */
  const [override, setOverride] = React.useState<'working' | 'granted' | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const state = override ?? permission;

  async function enable() {
    setOverride('working');
    setError(null);

    try {
      const token = await registerForPush();

      if (token) {
        setOverride('granted');
        return;
      }

      /*
       * Either the prompt was refused or this browser cannot complete the
       * setup. The permission itself is the honest answer about which, so the
       * override is dropped and the real value shows through.
       */
      setOverride(null);
      if (Notification.permission !== 'denied') {
        setError('This browser could not set up notifications.');
      }
    } catch {
      setOverride(null);
      setError('Something went wrong setting up notifications.');
    }
  }

  if (state === 'checking' || state === 'unsupported') return null;

  return (
    <div className="px-5 py-4 border-t border-line">
      <div className="flex items-start gap-3">
        <span className="size-9 shrink-0 rounded-xl bg-inset flex items-center justify-center mt-0.5">
          <BellRing aria-hidden className="size-4.5 text-muted" />
        </span>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-fg">Notifications on this device</p>
          <p className="text-xs text-muted mt-0.5 leading-relaxed">
            {state === 'granted'
              ? 'This device can receive alerts, including an SOS, while FamLink is closed.'
              : state === 'denied'
                ? 'Blocked in your browser settings. Allow notifications for this site, then reload.'
                : 'Needed for alerts to reach you while FamLink is closed — including an SOS.'}
          </p>
        </div>

        {state === 'granted' ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-on-tint-brand shrink-0 mt-1">
            <Check aria-hidden className="size-3.5" />
            On
          </span>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            className="shrink-0"
            disabled={state === 'working' || state === 'denied'}
            onClick={() => void enable()}
          >
            {state === 'working' ? (
              <Loader2 aria-hidden className="size-3.5 animate-spin" />
            ) : null}
            Turn on
          </Button>
        )}
      </div>

      {error && (
        <Alert tone="error" className="mt-3">
          {error}
        </Alert>
      )}
    </div>
  );
}

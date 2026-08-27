'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Check, Loader2, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { api, errorMessage } from '@/lib/api/client';
import { cn } from '@/lib/utils';

/**
 * The SOS control.
 *
 * Four rules shape this component:
 *
 *  1. It confirms before sending. An accidental family-wide emergency alert is
 *     its own small harm.
 *  2. It never blocks on location. A fix is attempted with a short deadline;
 *     if it does not arrive the alert goes anyway, saying so.
 *  3. It states its scope before the press, not after. FamLink alerts family
 *     members — it does not contact emergency services, and the copy says so
 *     where somebody deciding whether to press it will read it.
 *  4. It confirms delivery explicitly, because the sender cannot otherwise
 *     tell whether anything happened.
 */

/** Long enough for a warm fix, short enough not to delay a real emergency. */
const LOCATION_DEADLINE_MS = 6_000;

type Phase = 'idle' | 'confirming' | 'sending' | 'sent' | 'failed';

export function SosButton({
  familyId,
  familyName,
  compact = false,
}: {
  familyId: string;
  familyName: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  const [phase, setPhase] = React.useState<Phase>('idle');
  const [error, setError] = React.useState<string | null>(null);
  const [sentWithLocation, setSentWithLocation] = React.useState(false);

  const open = phase === 'confirming' || phase === 'sending' || phase === 'sent' || phase === 'failed';

  React.useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  /**
   * Best-effort position with a hard deadline. Resolves to null rather than
   * rejecting, so no failure path can prevent the alert being sent.
   */
  const getPositionOrNull = React.useCallback(async () => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return null;

    return new Promise<GeolocationPosition | null>((resolve) => {
      let settled = false;

      const finish = (value: GeolocationPosition | null) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      const timer = setTimeout(() => finish(null), LOCATION_DEADLINE_MS);

      navigator.geolocation.getCurrentPosition(
        (position) => {
          clearTimeout(timer);
          finish(position);
        },
        () => {
          clearTimeout(timer);
          finish(null);
        },
        { enableHighAccuracy: true, timeout: LOCATION_DEADLINE_MS, maximumAge: 30_000 },
      );
    });
  }, []);

  const send = React.useCallback(async () => {
    setPhase('sending');
    setError(null);

    const position = await getPositionOrNull();

    try {
      await api.post(`/api/v1/families/${familyId}/sos`, {
        latitude: position?.coords.latitude,
        longitude: position?.coords.longitude,
        accuracy: position?.coords.accuracy,
      });

      setSentWithLocation(position !== null);
      setPhase('sent');
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
      setPhase('failed');
    }
  }, [familyId, getPositionOrNull, router]);

  return (
    <>
      <button
        type="button"
        onClick={() => setPhase('confirming')}
        aria-label="Send an emergency alert to your family"
        className={cn(
          'inline-flex items-center justify-center gap-2 font-bold text-white',
          'bg-danger-600 hover:bg-danger-700 active:bg-danger-700',
          'transition-colors sos-pulse',
          compact ? 'h-10 px-3.5 rounded-xl text-sm' : 'h-12 px-6 rounded-2xl text-base',
        )}
      >
        <TriangleAlert aria-hidden className={compact ? 'size-4' : 'size-5'} />
        SOS
      </button>

      <dialog
        ref={dialogRef}
        onCancel={(e) => {
          e.preventDefault();
          if (phase !== 'sending') setPhase('idle');
        }}
        onClose={() => setPhase('idle')}
        className="m-auto w-[calc(100vw-2rem)] max-w-sm p-0 bg-transparent backdrop:bg-black/55"
      >
        <div className="bg-card border border-line rounded-2xl shadow-lift p-5 text-left">
          {phase === 'sent' ? (
            <>
              <div className="size-11 rounded-xl bg-tint-brand flex items-center justify-center">
                <Check aria-hidden className="size-6 text-on-tint-brand" />
              </div>
              <h2 className="text-base font-semibold mt-3">Alert sent</h2>
              <p className="text-sm text-muted mt-1.5 leading-relaxed">
                Everyone in {familyName} has been alerted.{' '}
                {sentWithLocation
                  ? 'Your location was included and is on their map.'
                  : 'Your location could not be determined, so the alert was sent without it.'}
              </p>

              <p className="text-xs text-subtle mt-3 leading-relaxed">
                If you need police, an ambulance or the fire service, call your local emergency
                number — FamLink cannot contact them for you.
              </p>

              <div className="mt-5 flex justify-end">
                <Button variant="secondary" onClick={() => setPhase('idle')}>
                  Done
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="size-11 rounded-xl bg-tint-danger flex items-center justify-center">
                <AlertTriangle aria-hidden className="size-6 text-on-tint-danger" />
              </div>

              <h2 className="text-base font-semibold mt-3">Send an emergency alert?</h2>
              <p className="text-sm text-muted mt-1.5 leading-relaxed">
                Everyone in {familyName} will be alerted immediately, along with your current
                location if it&rsquo;s available.
              </p>

              {/* Stated before the decision, not after it. */}
              <Alert tone="warning" className="mt-4">
                This alerts your family only. FamLink does not contact police, ambulance or any
                emergency service.
              </Alert>

              {error && (
                <Alert tone="error" className="mt-3">
                  {error}
                </Alert>
              )}

              {phase === 'sending' && (
                <p className="flex items-center gap-2 text-xs text-muted mt-3">
                  <Loader2 aria-hidden className="size-3.5 animate-spin" />
                  Getting your location…
                </p>
              )}

              <div className="mt-5 flex gap-2 justify-end">
                <Button
                  variant="secondary"
                  onClick={() => setPhase('idle')}
                  disabled={phase === 'sending'}
                >
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  loading={phase === 'sending'}
                  onClick={() => void send()}
                >
                  {phase === 'failed' ? 'Try again' : 'Send alert'}
                </Button>
              </div>
            </>
          )}
        </div>
      </dialog>
    </>
  );
}

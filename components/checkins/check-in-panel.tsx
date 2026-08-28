'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { HandHeart, MapPin, TriangleAlert, UserCheck } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Alert } from '@/components/ui/feedback';
import { api, errorMessage } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { timeAgo } from '@/lib/time';

export interface PendingCheckIn {
  id: string;
  requesterId: string;
  requesterName: string;
  note: string | null;
  createdAt: string;
}

/** How long to wait for a position before answering without one. */
const LOCATION_DEADLINE_MS = 5_000;

/**
 * Answers a check-in somebody has sent you.
 *
 * Two replies, both one tap. Sharing a position is a separate, explicit
 * choice — the plain "I'm OK" sends no location at all, and neither reply
 * changes the responder's standing sharing settings. That is what makes a
 * check-in a question rather than a tracking request.
 */
export function CheckInPanel({
  familyId,
  pending,
}: {
  familyId: string;
  pending: PendingCheckIn[];
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

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

  const respond = React.useCallback(
    async (checkInId: string, reply: 'ok' | 'need_help', withLocation: boolean) => {
      setBusy(checkInId);
      setError(null);

      const position = withLocation ? await getPositionOrNull() : null;

      try {
        await api.post(`/api/v1/families/${familyId}/check-ins/${checkInId}`, {
          reply,
          ...(position
            ? {
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
              }
            : {}),
        });
        router.refresh();
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setBusy(null);
      }
    },
    [familyId, getPositionOrNull, router],
  );

  if (pending.length === 0) return null;

  return (
    <section aria-label="Check-ins" className="space-y-3">
      {error && <Alert tone="error">{error}</Alert>}

      {pending.map((checkIn) => (
        <Card key={checkIn.id} className="border-brand-400/60">
          <CardContent className="pt-5">
            <div className="flex items-start gap-3">
              <span className="size-10 shrink-0 rounded-xl bg-tint-brand flex items-center justify-center">
                <UserCheck aria-hidden className="size-5 text-on-tint-brand" />
              </span>

              <div className="flex-1 min-w-0">
                <p className="font-semibold text-fg">
                  {checkIn.requesterName} is checking in
                </p>
                <p className="text-sm text-muted mt-0.5 leading-relaxed">
                  {checkIn.note
                    ? `“${checkIn.note}”`
                    : `${checkIn.requesterName} wants to know if you’re OK.`}
                </p>
                <p className="text-xs text-subtle mt-1">{timeAgo(checkIn.createdAt)}</p>
              </div>

              <Avatar
                name={checkIn.requesterName}
                userId={checkIn.requesterId}
                size="sm"
              />
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                size="sm"
                loading={busy === checkIn.id}
                onClick={() => void respond(checkIn.id, 'ok', false)}
              >
                <HandHeart aria-hidden className="size-3.5" />
                I&rsquo;m OK
              </Button>

              <Button
                size="sm"
                variant="secondary"
                disabled={busy !== null}
                onClick={() => void respond(checkIn.id, 'ok', true)}
              >
                <MapPin aria-hidden className="size-3.5" />
                I&rsquo;m OK, share where I am
              </Button>

              <Button
                size="sm"
                variant="danger"
                disabled={busy !== null}
                onClick={() => void respond(checkIn.id, 'need_help', true)}
              >
                <TriangleAlert aria-hidden className="size-3.5" />
                I need help
              </Button>
            </div>

            <p className="text-xs text-subtle mt-3 leading-relaxed">
              {/* Says exactly what each button discloses, before it is pressed. */}
              Replying doesn&rsquo;t change your location sharing settings. Sharing your
              position sends it once, just for this reply.
            </p>
          </CardContent>
        </Card>
      ))}
    </section>
  );
}

/* -------------------------------------------------------------------------- */

/** Sends a check-in to one family member. Used from the family member list. */
export function AskCheckInButton({
  familyId,
  targetId,
  targetName,
}: {
  familyId: string;
  targetId: string;
  targetName: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function ask() {
    setBusy(true);
    setError(null);

    try {
      await api.post(`/api/v1/families/${familyId}/check-ins`, { targetId });
      setSent(true);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <span className="text-xs text-on-tint-brand font-medium whitespace-nowrap">Asked</span>
    );
  }

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        loading={busy}
        onClick={() => void ask()}
        aria-label={`Ask ${targetName} if they're OK`}
        title={error ?? undefined}
        // Icon-only on a phone. In a member row this button competes with the
        // name, the sharing status and a menu for about 280px, and the label is
        // the first thing that can go without losing meaning.
        className={cn('px-2 sm:px-3', error && 'text-danger-600')}
      >
        <UserCheck aria-hidden className="size-3.5" />
        <span className="hidden sm:inline">Check in</span>
      </Button>

      {error && (
        <>
          {/* Announced everywhere; only spelled out where there is room for it. */}
          <span role="alert" className="sr-only">
            {error}
          </span>
          <span aria-hidden className="hidden sm:inline text-xs text-danger-600">
            {error}
          </span>
        </>
      )}
    </>
  );
}

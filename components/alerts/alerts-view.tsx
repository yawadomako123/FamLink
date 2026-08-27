'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Bell,
  CheckCheck,
  LogIn,
  LogOut,
  MapPin,
  MapPinOff,
  TriangleAlert,
  UserPlus,
} from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, EmptyState } from '@/components/ui/feedback';
import { useRealtime } from '@/hooks/useRealtime';
import { api, errorMessage } from '@/lib/api/client';
import { timeAgo } from '@/lib/time';
import { cn } from '@/lib/utils';
import type { NotificationType } from '@/lib/db/schema';

export interface NotificationItem {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  readAt: string | null;
  createdAt: string;
}

export interface EmergencyItem {
  id: string;
  userId: string;
  memberName: string;
  latitude: number | null;
  longitude: number | null;
  status: 'active' | 'resolved' | 'cancelled';
  createdAt: string;
}

const ICONS: Record<NotificationType, React.ElementType> = {
  ARRIVED_PLACE: LogIn,
  LEFT_PLACE: LogOut,
  LOCATION_ENABLED: MapPin,
  LOCATION_DISABLED: MapPinOff,
  FAMILY_INVITE: UserPlus,
  SOS: TriangleAlert,
};

export function AlertsView({
  familyId,
  viewerId,
  initialNotifications,
  initialEmergencies,
}: {
  familyId: string;
  viewerId: string;
  initialNotifications: NotificationItem[];
  initialEmergencies: EmergencyItem[];
}) {
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  // Refresh the server-rendered lists whenever something relevant happens.
  const onEvent = React.useCallback(
    (type: string) => {
      if (type === 'notification' || type === 'emergency') router.refresh();
    },
    [router],
  );

  useRealtime({ familyId, onEvent });

  const unread = initialNotifications.filter((n) => n.readAt === null);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-4 md:px-6 py-6 max-w-2xl space-y-5">
      {error && (
        <Alert tone="error" action={<Button size="sm" variant="ghost" onClick={() => setError(null)}>Dismiss</Button>}>
          {error}
        </Alert>
      )}

      {/* Active emergencies come first and are visually unmissable. */}
      {initialEmergencies.length > 0 && (
        <section aria-label="Active emergencies" className="space-y-3">
          {initialEmergencies.map((emergency) => (
            <div
              key={emergency.id}
              className="rounded-2xl border-2 border-danger-600 bg-tint-danger p-4"
            >
              <div className="flex items-start gap-3">
                <span className="size-10 shrink-0 rounded-xl bg-danger-600 flex items-center justify-center">
                  <TriangleAlert aria-hidden className="size-5 text-white" />
                </span>

                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-on-tint-danger">
                    {emergency.memberName} needs help
                  </p>
                  <p className="text-sm text-on-tint-danger/90 mt-0.5">
                    {emergency.latitude != null
                      ? 'Their location is on the map.'
                      : 'Their location was not available.'}{' '}
                    Sent {timeAgo(emergency.createdAt)}.
                  </p>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={busy}
                      onClick={() =>
                        void run(() =>
                          api.post(`/api/v1/families/${familyId}/sos/${emergency.id}`, {
                            action: 'resolve',
                          }),
                        )
                      }
                    >
                      Mark resolved
                    </Button>

                    {/* Only the sender can call it a false alarm. */}
                    {emergency.userId === viewerId && (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy}
                        onClick={() =>
                          void run(() =>
                            api.post(`/api/v1/families/${familyId}/sos/${emergency.id}`, {
                              action: 'cancel',
                            }),
                          )
                        }
                      >
                        False alarm
                      </Button>
                    )}
                  </div>

                  <p className="text-xs text-on-tint-danger/80 mt-3 leading-relaxed">
                    FamLink alerts your family only. For police, ambulance or fire, call your
                    local emergency number.
                  </p>
                </div>
              </div>
            </div>
          ))}
        </section>
      )}

      <Card>
        <CardHeader className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>Alerts</CardTitle>
            {unread.length > 0 && (
              <p className="text-sm text-muted mt-1">
                {unread.length} unread
              </p>
            )}
          </div>

          {unread.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() =>
                void run(() => api.post(`/api/v1/families/${familyId}/notifications/read`, {}))
              }
            >
              <CheckCheck aria-hidden className="size-3.5" />
              Mark all read
            </Button>
          )}
        </CardHeader>

        {initialNotifications.length === 0 ? (
          <EmptyState
            icon={Bell}
            title="No alerts yet"
            description="Arrivals, departures and emergency alerts from your family will appear here."
            className="py-10"
          />
        ) : (
          <ul className="divide-y divide-line border-t border-line">
            {initialNotifications.map((notification) => {
              const Icon = ICONS[notification.type] ?? Bell;
              const isUnread = notification.readAt === null;
              const isSos = notification.type === 'SOS';

              return (
                <li
                  key={notification.id}
                  className={cn('flex gap-3 px-5 py-3.5', isUnread && 'bg-raised/60')}
                >
                  <span
                    className={cn(
                      'size-9 shrink-0 rounded-full flex items-center justify-center mt-0.5',
                      isSos ? 'bg-tint-danger' : 'bg-inset',
                    )}
                  >
                    <Icon
                      aria-hidden
                      className={cn('size-4', isSos ? 'text-on-tint-danger' : 'text-subtle')}
                    />
                  </span>

                  <div className="flex-1 min-w-0">
                    <p
                      className={cn(
                        'text-sm truncate',
                        isUnread ? 'font-semibold text-fg' : 'font-medium text-fg',
                      )}
                    >
                      {notification.title}
                    </p>
                    <p className="text-xs text-muted mt-0.5 leading-relaxed">
                      {notification.message}
                    </p>
                    <p className="text-xs text-subtle mt-1">
                      {timeAgo(notification.createdAt)}
                    </p>
                  </div>

                  {isUnread && (
                    <span
                      aria-label="Unread"
                      className="size-2 rounded-full bg-brand-500 shrink-0 mt-2"
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

/** Small avatar row used where an alert names a member. */
export function AlertActor({ name, userId }: { name: string; userId: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Avatar name={name} userId={userId} size="xs" />
      <span className="text-xs text-muted">{name}</span>
    </span>
  );
}

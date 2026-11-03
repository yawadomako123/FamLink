'use client';

import * as React from 'react';
import { Clock, UserX } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Card, CardContent } from '@/components/ui/card';
import { timeAgo } from '@/lib/time';

export interface SentCheckIn {
  id: string;
  targetId: string;
  targetName: string;
  status: 'pending' | 'expired';
  createdAt: string;
}

/**
 * What became of the check-ins you sent.
 *
 * This existed as a hole rather than a feature. Asking "are you OK?" produced
 * a notification if the answer came back, and *nothing whatsoever* if it did
 * not — which looks exactly like the app having failed to ask. The one outcome
 * a worried person most needs to see was the one the app never showed them.
 *
 * Deliberately only unanswered asks. An answer already arrives as its own
 * alert and sits in the list below; repeating it here would turn a short,
 * glanceable summary into a second copy of the log.
 */
export function SentCheckIns({ sent }: { sent: SentCheckIn[] }) {
  if (sent.length === 0) return null;

  return (
    <section aria-label="Check-ins you sent" className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-subtle px-1">
        Waiting on a reply
      </h2>

      <Card>
        <CardContent className="pt-0 divide-y divide-line">
          {sent.map((checkIn) => {
            const unanswered = checkIn.status === 'expired';

            return (
              <div key={checkIn.id} className="flex items-center gap-3 py-3 first:pt-5">
                <span
                  className={
                    unanswered
                      ? 'size-9 shrink-0 rounded-xl bg-inset flex items-center justify-center'
                      : 'size-9 shrink-0 rounded-xl bg-tint-brand flex items-center justify-center'
                  }
                >
                  {unanswered ? (
                    <UserX aria-hidden className="size-4 text-muted" />
                  ) : (
                    <Clock aria-hidden className="size-4 text-on-tint-brand" />
                  )}
                </span>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-fg truncate">
                    You asked {checkIn.targetName}
                  </p>
                  <p className="text-xs text-muted mt-0.5">
                    {/*
                      Stated as what happened, not as a failure on their part.
                      A phone can be dead, silent, or in a pocket — the app
                      knows only that no answer arrived.
                    */}
                    {unanswered
                      ? `No reply — asked ${timeAgo(checkIn.createdAt)}`
                      : `Waiting for a reply · ${timeAgo(checkIn.createdAt)}`}
                  </p>
                </div>

                <Avatar name={checkIn.targetName} userId={checkIn.targetId} size="sm" />
              </div>
            );
          })}
        </CardContent>
      </Card>
    </section>
  );
}

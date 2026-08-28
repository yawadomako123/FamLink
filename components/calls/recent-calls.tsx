import { Phone, PhoneMissed, Video } from 'lucide-react';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar } from '@/components/ui/avatar';
import { callDuration, timeAgo } from '@/lib/time';
import { cn } from '@/lib/utils';
import type { CallKind, CallStatus } from '@/lib/db/schema';

export interface RecentCall {
  id: string;
  kind: CallKind;
  status: CallStatus;
  initiatorId: string;
  initiatorName: string;
  startedAt: string;
  answeredAt: string | null;
  endedAt: string | null;
}

/**
 * The family's recent calls.
 *
 * Deliberately shows who started a call rather than "incoming" or "outgoing":
 * a FamLink call rings the whole family at once, so there is no single other
 * party for the arrow to point at.
 */
export function RecentCalls({
  calls,
  viewerId,
}: {
  calls: RecentCall[];
  viewerId: string;
}) {
  if (calls.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent calls</CardTitle>
      </CardHeader>

      <ul className="divide-y divide-line border-t border-line">
        {calls.map((call) => {
          const missed = call.status === 'missed' || call.status === 'declined';
          const duration = callDuration(call.answeredAt, call.endedAt);
          const mine = call.initiatorId === viewerId;

          const KindIcon = missed ? PhoneMissed : call.kind === 'video' ? Video : Phone;

          return (
            <li key={call.id} className="flex items-center gap-3 px-5 py-3">
              <Avatar name={call.initiatorName} userId={call.initiatorId} size="sm" />

              {/*
                Who, then what — the order a phone's call log uses, and the
                order that survives truncation on a narrow screen. Leading with
                "Akua started a video call" put the only two words that matter
                past the ellipsis.
              */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-fg truncate">
                  {mine ? 'You' : call.initiatorName}
                </p>
                <p className="text-xs text-muted truncate">
                  {call.kind === 'video' ? 'Video' : 'Voice'} · {timeAgo(call.startedAt)}
                  {/*
                    A missed call says so instead of showing a length. It has
                    no length, and a blank space there reads as a bug.
                  */}
                  {missed
                    ? ` · ${call.status === 'declined' ? 'Declined' : 'No answer'}`
                    : duration
                      ? ` · ${duration}`
                      : ''}
                </p>
              </div>

              <KindIcon
                aria-hidden
                className={cn('size-4 shrink-0', missed ? 'text-danger-600' : 'text-subtle')}
              />
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

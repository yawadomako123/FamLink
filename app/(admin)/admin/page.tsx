import type { Metadata } from 'next';
import { AlertTriangle, MessageCircle, MapPin, Phone, Users2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { dailyGrowth, deploymentHealth, platformOverview } from '@/lib/admin/service';
import { GrowthChart } from './growth-chart';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Overview' };
export const dynamic = 'force-dynamic';

export default async function AdminOverviewPage() {
  const [overview, growth, health] = await Promise.all([
    platformOverview(),
    dailyGrowth(30),
    deploymentHealth(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Overview</h1>
        <p className="text-sm text-muted mt-1">
          Counts only. Nothing on this screen reads a message, a location or a recording.
        </p>
      </div>

      {overview.activity.sosActive > 0 && (
        <Card className="border-danger-500 bg-tint-danger">
          <div className="flex items-center gap-3 px-5 py-4">
            <AlertTriangle aria-hidden className="size-5 text-danger-600 shrink-0" />
            <p className="text-sm font-medium text-fg">
              {overview.activity.sosActive} emergency
              {overview.activity.sosActive === 1 ? '' : ' alerts'} currently active.
            </p>
          </div>
        </Card>
      )}

      <section aria-label="Headline numbers" className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="People" value={overview.users.total} hint={`+${overview.users.newThisWeek} this week`} />
        <Stat label="Families" value={overview.families.total} hint={`${overview.families.averageSize} avg size`} />
        <Stat label="Signed in now" value={overview.users.activeSessions} hint="live sessions" />
        <Stat label="Using Google" value={overview.users.withGoogle} hint="of all accounts" />
      </section>

      <Card>
        <div className="px-5 pt-5 pb-2">
          <h2 className="text-base font-semibold tracking-tight">Last 30 days</h2>
          <p className="text-xs text-muted mt-0.5">New people and new families per day.</p>
        </div>
        <GrowthChart data={growth} />
      </Card>

      <section aria-label="Activity" className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat icon={MessageCircle} label="Messages" value={overview.activity.messages} hint={`${overview.activity.messagesThisWeek} this week`} />
        <Stat icon={Phone} label="Calls" value={overview.activity.calls} hint={`${overview.activity.callsThisWeek} this week`} />
        <Stat icon={MapPin} label="Places" value={overview.activity.places} hint="saved by families" />
        <Stat icon={Users2} label="Sharing location" value={overview.reach.sharingLocation} hint="memberships" />
      </section>

      <Card>
        <div className="px-5 pt-5 pb-3">
          <h2 className="text-base font-semibold tracking-tight">This deployment</h2>
          <p className="text-xs text-muted mt-0.5">
            Optional pieces. Each one has already been the cause of something looking broken
            with no way to tell from inside the app.
          </p>
        </div>

        <ul className="divide-y divide-line border-t border-line">
          <HealthRow
            label="Relay for calls (TURN)"
            ok={health.turn !== 'none'}
            detail={
              health.turn === 'none'
                ? 'Not configured — roughly one call in five will fail on mobile data'
                : `Configured (${health.turn} credentials)`
            }
          />
          <HealthRow
            label="File storage (Blob)"
            ok={health.blobStorage}
            detail={
              health.blobStorage
                ? 'Voice notes and photos can be uploaded'
                : 'Not connected — voice notes and photo uploads are hidden'
            }
          />
          <HealthRow
            label="Google sign-in"
            ok={health.googleAuth}
            detail={health.googleAuth ? 'Offered on sign-in and sign-up' : 'Not configured — button hidden'}
          />
          <HealthRow
            label="Push notifications"
            ok={health.push}
            detail={health.push ? 'Firebase credentials present' : 'Not configured — nothing reaches a closed app'}
          />
          <HealthRow
            label="Email"
            ok={health.email}
            detail={health.email ? 'Password resets can be sent' : 'Not configured — password resets will not arrive'}
          />
        </ul>
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Stat({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: number;
  hint?: string;
  icon?: React.ElementType;
}) {
  return (
    <Card>
      <div className="px-4 py-4">
        <div className="flex items-center gap-1.5 text-muted">
          {Icon && <Icon aria-hidden className="size-3.5" />}
          <span className="text-xs font-medium">{label}</span>
        </div>
        <p className="text-2xl font-semibold tracking-tight mt-1 tabular-nums">
          {value.toLocaleString()}
        </p>
        {hint && <p className="text-xs text-subtle mt-0.5 truncate">{hint}</p>}
      </div>
    </Card>
  );
}

function HealthRow({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <li className="flex items-start gap-3 px-5 py-3">
      <span
        aria-hidden
        className={cn(
          'mt-1.5 size-2 rounded-full shrink-0',
          ok ? 'bg-status-sharing' : 'bg-status-paused',
        )}
      />
      <div className="min-w-0">
        <p className="text-sm font-medium text-fg">
          {label}
          <span className="sr-only">: {ok ? 'configured' : 'not configured'}</span>
        </p>
        <p className="text-xs text-muted mt-0.5">{detail}</p>
      </div>
    </li>
  );
}

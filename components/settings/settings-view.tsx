'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  Bell,
  BellOff,
  BatteryLow,
  Clock,
  LogIn,
  LogOut,
  MapPin,
  MessageCircle,
  Moon,
  ShieldAlert,
  Smartphone,
  Sun,
  UserCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Alert } from '@/components/ui/feedback';
import { api, errorMessage } from '@/lib/api/client';
import { CallDiagnostic } from './call-diagnostic';
import { cn } from '@/lib/utils';

export interface PreferencesState {
  arrivals: boolean;
  departures: boolean;
  sharingChanges: boolean;
  lowBattery: boolean;
  chatMessages: boolean;
  checkIns: boolean;
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
}

type ToggleKey = Exclude<keyof PreferencesState, 'quietHoursStart' | 'quietHoursEnd'>;

const TOGGLES: {
  key: ToggleKey;
  icon: React.ElementType;
  title: string;
  description: string;
}[] = [
  {
    key: 'arrivals',
    icon: LogIn,
    title: 'Arrivals',
    description: 'When someone reaches a place like Home or School.',
  },
  {
    key: 'departures',
    icon: LogOut,
    title: 'Departures',
    description: 'When someone leaves a place.',
  },
  {
    key: 'sharingChanges',
    icon: MapPin,
    title: 'Sharing changes',
    description: 'When a family member turns location sharing on or off.',
  },
  {
    key: 'lowBattery',
    icon: BatteryLow,
    title: 'Low battery',
    description: "When a family member's phone is about to die.",
  },
  {
    key: 'chatMessages',
    icon: MessageCircle,
    title: 'Chat messages',
    description: 'New messages in the family conversation.',
  },
  {
    key: 'checkIns',
    icon: UserCheck,
    title: 'Check-ins',
    description: 'When someone asks if you’re OK, or answers you.',
  },
];

export function SettingsView({
  familyId,
  familyName,
  initialPreferences,
}: {
  familyId: string | null;
  familyName: string | null;
  initialPreferences: PreferencesState;
}) {
  const [preferences, setPreferences] = React.useState(initialPreferences);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  async function update(changes: Partial<PreferencesState>) {
    if (!familyId) return;

    const previous = preferences;
    // Optimistic: a switch that waits on the network feels broken.
    setPreferences((current) => ({ ...current, ...changes }));
    setSaving(true);
    setError(null);

    try {
      await api.patch(`/api/v1/families/${familyId}/preferences`, changes);
    } catch (err) {
      setPreferences(previous);
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const quietHoursOn =
    preferences.quietHoursStart !== null && preferences.quietHoursEnd !== null;

  return (
    <div className="px-4 md:px-6 py-6 max-w-2xl space-y-5">
      {error && (
        <Alert
          tone="error"
          action={
            <Button size="sm" variant="ghost" onClick={() => setError(null)}>
              Dismiss
            </Button>
          }
        >
          {error}
        </Alert>
      )}

      {/* ---------------------------------------------------- notifications -- */}
      <Card>
        <CardHeader>
          <CardTitle>Notifications</CardTitle>
          {familyName && (
            <p className="text-sm text-muted mt-1">
              These apply to {familyName}. Each family has its own settings.
            </p>
          )}
        </CardHeader>

        {familyId ? (
          <ul className="divide-y divide-line border-t border-line">
            {TOGGLES.map(({ key, icon: Icon, title, description }) => (
              <li key={key} className="flex items-start gap-3 px-5 py-3.5">
                <span className="size-9 shrink-0 rounded-xl bg-inset flex items-center justify-center mt-0.5">
                  <Icon aria-hidden className="size-4 text-muted" />
                </span>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-fg">{title}</p>
                  <p className="text-xs text-muted mt-0.5 leading-relaxed">{description}</p>
                </div>

                <Switch
                  checked={preferences[key]}
                  disabled={saving}
                  label={title}
                  onCheckedChange={(value) => void update({ [key]: value })}
                  className="mt-0.5"
                />
              </li>
            ))}
          </ul>
        ) : (
          <CardContent className="pt-0">
            <p className="text-sm text-muted">
              Notification settings appear once you&rsquo;re part of a family.{' '}
              <Link href="/family" className="font-medium text-on-tint-brand hover:underline">
                Create or join one
              </Link>
              .
            </p>
          </CardContent>
        )}
      </Card>

      {/* Stated as a guarantee, not a missing feature. */}
      <Alert tone="info" title="Emergency alerts can't be switched off">
        <span className="inline-flex items-start gap-1.5">
          <ShieldAlert aria-hidden className="size-3.5 mt-0.5 shrink-0" />
          An SOS from your family always reaches you, whatever these settings say and whatever
          the time. A family where somebody has muted the emergency alert isn&rsquo;t a safety
          net.
        </span>
      </Alert>

      {/* ------------------------------------------------------ quiet hours -- */}
      {familyId && (
        <Card>
          <CardHeader className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <CardTitle>Quiet hours</CardTitle>
              <p className="text-sm text-muted mt-1 leading-relaxed">
                Silence routine alerts overnight. Emergency alerts still come through.
              </p>
            </div>
            <Switch
              checked={quietHoursOn}
              disabled={saving}
              label="Quiet hours"
              onCheckedChange={(on) =>
                void update(
                  on
                    ? { quietHoursStart: 22 * 60, quietHoursEnd: 7 * 60 }
                    : { quietHoursStart: null, quietHoursEnd: null },
                )
              }
            />
          </CardHeader>

          {quietHoursOn && (
            <CardContent className="pt-0 flex items-center gap-3">
              <Clock aria-hidden className="size-4 text-muted shrink-0" />
              <TimeField
                label="From"
                value={preferences.quietHoursStart ?? 22 * 60}
                onChange={(minutes) => void update({ quietHoursStart: minutes })}
                disabled={saving}
              />
              <span className="text-sm text-muted">to</span>
              <TimeField
                label="To"
                value={preferences.quietHoursEnd ?? 7 * 60}
                onChange={(minutes) => void update({ quietHoursEnd: minutes })}
                disabled={saving}
              />
            </CardContent>
          )}
        </Card>
      )}

      {/* Configuring a relay is not the same as it working, so this checks. */}
      {familyId && <CallDiagnostic />}

      {/* ------------------------------------------------------- appearance -- */}
      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <p className="text-sm text-muted mt-1">
            FamLink follows your device by default.
          </p>
        </CardHeader>
        <CardContent className="pt-0">
          <ThemePicker />
        </CardContent>
      </Card>

      {/* ---------------------------------------------------------- privacy -- */}
      <Card>
        <CardHeader>
          <CardTitle>Privacy</CardTitle>
        </CardHeader>
        <ul className="divide-y divide-line border-t border-line">
          <li>
            <Link
              href="/profile"
              className="flex items-center gap-3 px-5 py-4 hover:bg-raised transition-colors"
            >
              <MapPin aria-hidden className="size-4.5 text-muted" />
              <span className="flex-1">
                <span className="block text-sm font-medium text-fg">Location sharing</span>
                <span className="block text-xs text-muted mt-0.5">
                  Who can see you, and for how long
                </span>
              </span>
            </Link>
          </li>
          <li>
            <Link
              href="/history"
              className="flex items-center gap-3 px-5 py-4 hover:bg-raised transition-colors"
            >
              <Clock aria-hidden className="size-4.5 text-muted" />
              <span className="flex-1">
                <span className="block text-sm font-medium text-fg">My location history</span>
                <span className="block text-xs text-muted mt-0.5">
                  Only you can see it — and you can delete it
                </span>
              </span>
            </Link>
          </li>
        </ul>
      </Card>

      {/* ------------------------------------------------------------ about -- */}
      <Card>
        <CardHeader>
          <CardTitle>How FamLink works</CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-3 text-sm text-muted leading-relaxed">
          <p className="flex gap-2.5">
            <Smartphone aria-hidden className="size-4 shrink-0 mt-0.5" />
            <span>
              Location updates only while FamLink is open. Browsers don&rsquo;t allow web apps
              to read your location in the background, so closing the app stops sharing until
              you open it again. Your family sees your last known position, labelled with when
              it was recorded.
            </span>
          </p>
          <p className="flex gap-2.5">
            <BellOff aria-hidden className="size-4 shrink-0 mt-0.5" />
            <span>
              FamLink alerts your family and nobody else. It does not contact police, ambulance
              or any emergency service.
            </span>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function TimeField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (minutes: number) => void;
  disabled: boolean;
}) {
  const hh = String(Math.floor(value / 60)).padStart(2, '0');
  const mm = String(value % 60).padStart(2, '0');

  return (
    <label className="flex-1">
      <span className="sr-only">{label}</span>
      <input
        type="time"
        value={`${hh}:${mm}`}
        disabled={disabled}
        onChange={(event) => {
          const [h, m] = event.target.value.split(':').map(Number);
          if (Number.isFinite(h) && Number.isFinite(m)) onChange(h! * 60 + m!);
        }}
        className="w-full h-10 px-3 rounded-xl bg-card text-fg border border-line-strong outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/25"
      />
    </label>
  );
}

type Theme = 'system' | 'light' | 'dark';
const THEME_KEY = 'famlink:theme';

/**
 * Theme preference.
 *
 * Stored in localStorage rather than the database: it is a per-device
 * preference — a phone at night and a desktop by day want different answers —
 * and losing it costs nothing.
 */
function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    // Blocked storage (private mode, or site data disabled).
  }
  return 'system';
}

function ThemePicker() {
  /*
   * Subscribed rather than mirrored into state from an effect. The stored
   * theme is external device state, and `storage` events mean a change in
   * another tab is reflected here too. The server snapshot is 'system', which
   * matches what the un-themed markup renders.
   */
  const theme = React.useSyncExternalStore(
    (onStoreChange) => {
      window.addEventListener('storage', onStoreChange);
      window.addEventListener('famlink:theme', onStoreChange);
      return () => {
        window.removeEventListener('storage', onStoreChange);
        window.removeEventListener('famlink:theme', onStoreChange);
      };
    },
    readStoredTheme,
    () => 'system' as Theme,
  );

  const apply = React.useCallback((next: Theme) => {
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    if (next !== 'system') root.classList.add(next);

    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // Not being able to remember it is not worth surfacing.
    }

    // `storage` only fires in *other* tabs, so nudge this one explicitly.
    window.dispatchEvent(new Event('famlink:theme'));
  }, []);

  const options: { value: Theme; label: string; icon: React.ElementType }[] = [
    { value: 'system', label: 'System', icon: Smartphone },
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
  ];

  return (
    <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-2">
      {options.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={theme === value}
          onClick={() => apply(value)}
          className={cn(
            'flex flex-col items-center gap-1.5 py-3 rounded-xl border text-sm font-medium transition-colors',
            theme === value
              ? 'border-brand-500 bg-tint-brand text-on-tint-brand'
              : 'border-line text-muted hover:bg-raised hover:text-fg',
          )}
        >
          <Icon aria-hidden className="size-4" />
          {label}
        </button>
      ))}
    </div>
  );
}

export { Bell };

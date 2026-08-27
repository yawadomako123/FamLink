'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, Info, MapPin, Pause, Play, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Alert } from '@/components/ui/feedback';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useLocation } from '@/hooks/useLocation';
import { api, errorMessage } from '@/lib/api/client';
import { timeAgo } from '@/lib/time';
import { cn } from '@/lib/utils';
import type { LocationSharingState, LocationVisibility } from '@/lib/db/schema';

/**
 * The location sharing control.
 *
 * Design rules this component follows deliberately:
 *  - Stopping is always one tap away and never hidden behind a menu.
 *  - The current state is stated in words, not only by a switch position.
 *  - Every failure mode says what happened and what the person can do.
 *  - It never implies sharing continues in the background.
 */
export function SharingControl({
  familyId,
  familyName,
  initialState,
  initialVisibility,
}: {
  familyId: string;
  familyName: string;
  initialState: LocationSharingState;
  initialVisibility: LocationVisibility;
}) {
  const router = useRouter();
  const {
    state,
    permission,
    lastFix,
    lastSentAt,
    problem,
    backgroundLimited,
    pending,
    startSharing,
    pauseSharing,
    stopSharing,
    dismissProblem,
  } = useLocation({ familyId, initialState });

  const [visibility, setVisibility] = React.useState<LocationVisibility>(initialVisibility);
  const [visibilityPending, setVisibilityPending] = React.useState(false);
  const [forgetOpen, setForgetOpen] = React.useState(false);
  const [forgetting, setForgetting] = React.useState(false);
  const [settingsError, setSettingsError] = React.useState<string | null>(null);

  // Keep server-rendered surfaces (member list, map) in step with the switch.
  React.useEffect(() => {
    router.refresh();
  }, [state, router]);

  const isOn = state === 'sharing';
  const isPaused = state === 'paused';

  async function changeVisibility(next: LocationVisibility) {
    setVisibilityPending(true);
    setSettingsError(null);
    const previous = visibility;
    setVisibility(next);

    try {
      await api.patch(`/api/v1/families/${familyId}/sharing`, { visibility: next });
      router.refresh();
    } catch (error) {
      setVisibility(previous);
      setSettingsError(errorMessage(error));
    } finally {
      setVisibilityPending(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* ---------------------------------------------------------------- */}
      <Card className={cn(isOn && 'border-brand-400/60')}>
        <CardContent className="pt-5">
          <div className="flex items-start gap-4">
            <div
              className={cn(
                'size-11 shrink-0 rounded-xl flex items-center justify-center transition-colors',
                isOn ? 'bg-tint-brand' : 'bg-inset',
              )}
            >
              <MapPin
                aria-hidden
                className={cn('size-5', isOn ? 'text-on-tint-brand' : 'text-subtle')}
              />
            </div>

            <div className="flex-1 min-w-0">
              <p className="font-semibold text-fg">Location sharing</p>
              <p className="text-sm text-muted mt-0.5 leading-relaxed">
                {isOn
                  ? `Your location is being shared with ${familyName}.`
                  : isPaused
                    ? 'Paused. Nobody can see where you are.'
                    : `Off. Nobody in ${familyName} can see where you are.`}
              </p>
            </div>

            <Switch
              checked={isOn}
              disabled={pending || permission === 'unsupported'}
              label="Share my location with this family"
              onCheckedChange={(next) => {
                if (next) void startSharing();
                else void stopSharing();
              }}
            />
          </div>

          {/* The stop control stays visible whenever anything is being
              collected, so it is never more than one tap away. */}
          {(isOn || isPaused) && (
            <div className="mt-4 flex gap-2">
              {isOn ? (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={pending}
                  onClick={() => void pauseSharing()}
                >
                  <Pause aria-hidden className="size-3.5" />
                  Pause
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={pending}
                  onClick={() => void startSharing()}
                >
                  <Play aria-hidden className="size-3.5" />
                  Resume
                </Button>
              )}

              <Button
                variant="danger"
                size="sm"
                loading={pending}
                onClick={() => void stopSharing()}
              >
                <Square aria-hidden className="size-3.5" />
                Stop sharing
              </Button>
            </div>
          )}

          {isOn && (
            <p className="text-xs text-subtle mt-3">
              {lastSentAt
                ? `Last shared ${timeAgo(lastSentAt)}`
                : lastFix
                  ? 'Getting your first fix…'
                  : 'Waiting for your device to report a position…'}
              {lastFix?.accuracy != null && ` · accurate to about ${Math.round(lastFix.accuracy)}m`}
            </p>
          )}
        </CardContent>
      </Card>

      {/* ---------------------------------------------------------------- */}
      {problem && (
        <Alert
          tone={problem.kind === 'permission-denied' ? 'error' : 'warning'}
          action={
            <Button size="sm" variant="ghost" onClick={dismissProblem}>
              Dismiss
            </Button>
          }
        >
          {problem.message}
        </Alert>
      )}

      {backgroundLimited && (
        <Alert tone="info" title="Sharing pauses when FamLink isn't open">
          Browsers don&rsquo;t allow web apps to read your location in the background. Your family
          will see your last known position until you open FamLink again.
        </Alert>
      )}

      {permission === 'denied' && state === 'off' && (
        <Alert tone="error" title="Location access is blocked">
          FamLink can&rsquo;t ask again from here. Allow location for this site in your browser
          settings, then switch sharing on.
        </Alert>
      )}

      {/* ---------------------------------------------------------------- */}
      <Card>
        <CardContent className="pt-5">
          <p className="font-semibold text-fg">Who can see my location?</p>
          <p className="text-sm text-muted mt-0.5">
            Applies to {familyName} only.
          </p>

          {settingsError && (
            <Alert tone="error" className="mt-3">
              {settingsError}
            </Alert>
          )}

          <div className="mt-4 space-y-2">
            <VisibilityOption
              checked={visibility === 'everyone'}
              disabled={visibilityPending}
              onSelect={() => void changeVisibility('everyone')}
              icon={Eye}
              title="Everyone in my family"
              description="All members of this family can see where you are while sharing is on."
            />
            <VisibilityOption
              checked={visibility === 'nobody'}
              disabled={visibilityPending}
              onSelect={() => void changeVisibility('nobody')}
              icon={EyeOff}
              title="Nobody"
              description="Your location is recorded for your own history, but no one else can see it."
            />
          </div>

          <p className="flex gap-2 text-xs text-subtle mt-4 leading-relaxed">
            <Info aria-hidden className="size-3.5 shrink-0 mt-0.5" />
            Sharing with selected family members is coming later. Until then, choose Nobody if you
            want to stay private while keeping your own history.
          </p>
        </CardContent>
      </Card>

      {/* ---------------------------------------------------------------- */}
      <Card>
        <CardContent className="pt-5 flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-fg">Stop sharing and delete my history</p>
            <p className="text-xs text-muted mt-1 leading-relaxed max-w-sm">
              Switches sharing off and permanently erases every location FamLink has stored for
              you in {familyName}.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setForgetOpen(true)}>
            Delete
          </Button>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={forgetOpen}
        onOpenChange={setForgetOpen}
        title="Delete your location history?"
        description={`This switches sharing off and permanently erases every location stored for you in ${familyName}. This cannot be undone.`}
        confirmLabel="Delete history"
        tone="danger"
        loading={forgetting}
        onConfirm={async () => {
          setForgetting(true);
          try {
            await api.post(`/api/v1/families/${familyId}/sharing/forget`);
            setForgetOpen(false);
            router.refresh();
          } catch (error) {
            setSettingsError(errorMessage(error));
          } finally {
            setForgetting(false);
          }
        }}
      />
    </div>
  );
}

function VisibilityOption({
  checked,
  disabled,
  onSelect,
  icon: Icon,
  title,
  description,
}: {
  checked: boolean;
  disabled: boolean;
  onSelect: () => void;
  icon: React.ElementType;
  title: string;
  description: string;
}) {
  return (
    <label
      className={cn(
        'flex gap-3 p-3 rounded-xl border transition-colors',
        disabled ? 'opacity-60 cursor-wait' : 'cursor-pointer',
        checked ? 'border-brand-500 bg-tint-brand' : 'border-line hover:bg-raised',
      )}
    >
      <input
        type="radio"
        name="location-visibility"
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
        className="mt-0.5 accent-brand-600"
      />
      <span className="flex-1">
        <span
          className={cn(
            'flex items-center gap-1.5 text-sm font-medium',
            checked ? 'text-on-tint-brand' : 'text-fg',
          )}
        >
          <Icon aria-hidden className="size-3.5" />
          {title}
        </span>
        <span className={cn('block text-xs mt-0.5', checked ? 'text-on-tint-brand' : 'text-muted')}>
          {description}
        </span>
      </span>
    </label>
  );
}

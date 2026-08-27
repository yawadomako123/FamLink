'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import {
  Briefcase,
  Dumbbell,
  GraduationCap,
  Home,
  Hospital,
  MapPin,
  Pencil,
  Plus,
  School,
  ShoppingBag,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field, Input } from '@/components/ui/input';
import { Alert, EmptyState } from '@/components/ui/feedback';
import { api, errorMessage } from '@/lib/api/client';
import {
  DEFAULT_RADIUS_M,
  MAX_RADIUS_M,
  MIN_RADIUS_M,
  placeIcons,
  type PlaceIcon,
} from '@/lib/validation/places';
import { cn } from '@/lib/utils';
import type { Place } from '@/lib/db/schema';

const PlacePickerMap = dynamic(
  () => import('./place-picker-map').then((m) => m.PlacePickerMap),
  { ssr: false, loading: () => <div className="h-64 skeleton rounded-xl" /> },
);

const ICONS: Record<PlaceIcon, React.ElementType> = {
  home: Home,
  school: School,
  work: Briefcase,
  university: GraduationCap,
  shop: ShoppingBag,
  gym: Dumbbell,
  hospital: Hospital,
  pin: MapPin,
};

/** Accra, as a last resort when we have nothing better to centre on. */
const FALLBACK_CENTRE = { latitude: 5.6037, longitude: -0.187 };

export function PlacesView({
  familyId,
  places,
  canEdit,
  suggestedCentre,
}: {
  familyId: string;
  places: Place[];
  /** userId -> whether the viewer may edit that place. Computed server-side. */
  canEdit: Record<string, boolean>;
  suggestedCentre: { latitude: number; longitude: number } | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<Place | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [pendingDelete, setPendingDelete] = React.useState<Place | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const centre = suggestedCentre ?? FALLBACK_CENTRE;

  if (creating || editing) {
    return (
      <PlaceForm
        familyId={familyId}
        place={editing}
        initialCentre={centre}
        onDone={() => {
          setCreating(false);
          setEditing(null);
          router.refresh();
        }}
        onCancel={() => {
          setCreating(false);
          setEditing(null);
        }}
      />
    );
  }

  return (
    <div className="px-4 md:px-6 py-6 max-w-2xl space-y-4">
      {error && (
        <Alert tone="error" action={<Button size="sm" variant="ghost" onClick={() => setError(null)}>Dismiss</Button>}>
          {error}
        </Alert>
      )}

      <Card>
        <CardHeader className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>Places</CardTitle>
            <p className="text-sm text-muted mt-1">
              Get told when family arrives or leaves.
            </p>
          </div>
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus aria-hidden className="size-3.5" />
            Add
          </Button>
        </CardHeader>

        {places.length === 0 ? (
          <EmptyState
            icon={MapPin}
            title="No places yet"
            description="Add Home, School or Work and FamLink will let the family know when someone arrives or leaves."
            action={<Button onClick={() => setCreating(true)}>Add your first place</Button>}
            className="py-10"
          />
        ) : (
          <ul className="divide-y divide-line border-t border-line">
            {places.map((place) => {
              const Icon = ICONS[(place.icon as PlaceIcon) ?? 'pin'] ?? MapPin;
              const editable = canEdit[place.id] ?? false;

              return (
                <li key={place.id} className="flex items-center gap-3 px-5 py-3.5">
                  <span className="size-10 shrink-0 rounded-xl bg-inset flex items-center justify-center">
                    <Icon aria-hidden className="size-5 text-muted" />
                  </span>

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-fg truncate">{place.name}</p>
                    <p className="text-xs text-muted mt-0.5">
                      {place.address ? `${place.address} · ` : ''}
                      {place.radius}m radius
                    </p>
                  </div>

                  {editable && (
                    <div className="flex items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => setEditing(place)}
                        aria-label={`Edit ${place.name}`}
                        className="size-8 rounded-lg flex items-center justify-center text-subtle hover:text-fg hover:bg-raised transition-colors"
                      >
                        <Pencil aria-hidden className="size-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingDelete(place)}
                        aria-label={`Delete ${place.name}`}
                        className="size-8 rounded-lg flex items-center justify-center text-subtle hover:text-danger-600 hover:bg-tint-danger transition-colors"
                      >
                        <Trash2 aria-hidden className="size-4" />
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/*
        Stated on the page itself, not only in the README: geofencing in a web
        app depends on FamLink being open, and a family relying on arrival
        alerts deserves to know that before they rely on them.
      */}
      <Alert tone="info" title="How arrival alerts work">
        FamLink checks these places whenever it receives a location update. Because browsers
        don&rsquo;t allow background location, that only happens while someone has FamLink open.
      </Alert>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title={`Delete ${pendingDelete?.name ?? 'this place'}?`}
        description="Arrival and departure alerts for this place will stop, and its history will be removed."
        confirmLabel="Delete"
        tone="danger"
        loading={busy}
        onConfirm={async () => {
          if (!pendingDelete) return;
          setBusy(true);
          try {
            await api.delete(`/api/v1/families/${familyId}/places/${pendingDelete.id}`);
            setPendingDelete(null);
            router.refresh();
          } catch (err) {
            setError(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function PlaceForm({
  familyId,
  place,
  initialCentre,
  onDone,
  onCancel,
}: {
  familyId: string;
  place: Place | null;
  initialCentre: { latitude: number; longitude: number };
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = React.useState(place?.name ?? '');
  const [address, setAddress] = React.useState(place?.address ?? '');
  const [icon, setIcon] = React.useState<PlaceIcon>((place?.icon as PlaceIcon) ?? 'pin');
  const [radius, setRadius] = React.useState(place?.radius ?? DEFAULT_RADIUS_M);
  const [position, setPosition] = React.useState({
    latitude: place?.latitude ?? initialCentre.latitude,
    longitude: place?.longitude ?? initialCentre.longitude,
  });
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [nameError, setNameError] = React.useState<string | undefined>(undefined);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!name.trim()) {
      setNameError('Give this place a name.');
      return;
    }

    setNameError(undefined);
    setSaving(true);

    const body = {
      name: name.trim(),
      address: address.trim() || undefined,
      latitude: position.latitude,
      longitude: position.longitude,
      radius,
      icon,
    };

    try {
      if (place) {
        await api.patch(`/api/v1/families/${familyId}/places/${place.id}`, body);
      } else {
        await api.post(`/api/v1/families/${familyId}/places`, body);
      }
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="px-4 md:px-6 py-6 max-w-2xl space-y-4">
      <h2 className="text-lg font-semibold tracking-tight">
        {place ? `Edit ${place.name}` : 'Add a place'}
      </h2>

      {error && <Alert tone="error">{error}</Alert>}

      <PlacePickerMap
        latitude={position.latitude}
        longitude={position.longitude}
        radius={radius}
        onMove={setPosition}
        className="h-64"
      />

      <p className="text-xs text-muted -mt-1">
        Drag the map to put the pin where this place is.
      </p>

      <Field label="Name" htmlFor="place-name" error={nameError}>
        <Input
          id="place-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Home"
          maxLength={60}
          required
          invalid={Boolean(nameError)}
        />
      </Field>

      <Field
        label="Area"
        htmlFor="place-address"
        hint="Optional — shown under the name, e.g. “Accra”."
      >
        <Input
          id="place-address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Accra"
          maxLength={120}
        />
      </Field>

      <fieldset>
        <legend className="text-sm font-medium text-fg">Icon</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {placeIcons.map((key) => {
            const Icon = ICONS[key];
            const active = icon === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setIcon(key)}
                aria-pressed={active}
                aria-label={key}
                className={cn(
                  'size-11 rounded-xl border flex items-center justify-center transition-colors',
                  active
                    ? 'border-brand-500 bg-tint-brand text-on-tint-brand'
                    : 'border-line text-muted hover:bg-raised hover:text-fg',
                )}
              >
                <Icon aria-hidden className="size-5" />
              </button>
            );
          })}
        </div>
      </fieldset>

      <div>
        <label htmlFor="place-radius" className="block text-sm font-medium text-fg">
          Radius: <span className="tabular-nums">{radius}m</span>
        </label>
        <input
          id="place-radius"
          type="range"
          min={MIN_RADIUS_M}
          max={1000}
          step={25}
          value={radius}
          onChange={(e) => setRadius(Number(e.target.value))}
          className="w-full mt-2 accent-brand-600"
        />
        <p className="text-xs text-muted mt-1">
          {/* Explains the floor rather than silently clamping the input. */}
          Smaller than {MIN_RADIUS_M}m isn&rsquo;t reliable — phone GPS isn&rsquo;t precise
          enough, and you&rsquo;d get false alerts. Maximum {MAX_RADIUS_M}m.
        </p>
      </div>

      <div className="flex gap-2 pt-2">
        <Button type="submit" loading={saving}>
          {place ? 'Save changes' : 'Add place'}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

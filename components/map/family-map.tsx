'use client';

import * as React from 'react';
// maplibre-gl ships as ESM named exports; there is no default export.
import { Map as MapLibreMap, Marker, NavigationControl, GeolocateControl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { avatarColor, cn, initials } from '@/lib/utils';
import { boundsOf, resolveMapStyle } from '@/lib/location/map-style';
import { locationFreshness } from '@/lib/time';
import type { MemberLocation } from '@/lib/location/types';

/**
 * The family map.
 *
 * MapLibre is driven imperatively here rather than through a React wrapper:
 * markers are long-lived DOM nodes that should be moved, not unmounted and
 * recreated, and a wrapper would add a version-compatibility surface for no
 * benefit at this size.
 *
 * Freshness is expressed visually as well as in words — a stale marker is
 * desaturated and loses its ring, so an out-of-date position never looks like
 * a live one at a glance.
 */
export function FamilyMap({
  locations,
  selectedUserId,
  onSelect,
  className,
}: {
  locations: MemberLocation[];
  selectedUserId?: string | null;
  onSelect?: (userId: string | null) => void;
  className?: string;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<MapLibreMap | null>(null);
  const markersRef = React.useRef<Map<string, Marker>>(new Map());
  const [ready, setReady] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  // Fit to the family once; refitting on every update would fight the user.
  const hasFitRef = React.useRef(false);

  /* ------------------------------------------------------------- create -- */

  React.useEffect(() => {
    if (mapRef.current) return;

    // markersRef holds one stable Map for the component's lifetime; captured
    // here so cleanup does not read a ref that may have moved on.
    const markers = markersRef.current;
    let map: MapLibreMap | null = null;
    let cancelled = false;

    /*
     * Deferred one frame rather than constructed inline: the container must be
     * laid out before MapLibre measures it, or the initial fitBounds is
     * computed against a zero-size box. It also keeps failure reporting off the
     * synchronous effect path.
     */
    const frame = requestAnimationFrame(() => {
      if (cancelled || !containerRef.current) return;

      try {
        map = new MapLibreMap({
          container: containerRef.current,
          style: resolveMapStyle(),
          center: [0, 20],
          zoom: 1.4,
          attributionControl: { compact: true },
          // Pitch and rotation add nothing to a "where is everyone" map and
          // make it easy to get lost.
          pitchWithRotate: false,
          dragRotate: false,
          touchZoomRotate: true,
        });
      } catch {
        setFailed(true);
        return;
      }

      map.touchZoomRotate.disableRotation();
      map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right');
      map.addControl(
        new GeolocateControl({
          // The map's own locate button must not become a second, hidden way
          // to start sharing — it only recentres the view.
          trackUserLocation: false,
          showAccuracyCircle: true,
        }),
        'bottom-right',
      );

      map.on('load', () => setReady(true));
      map.on('error', (event) => {
        // A failed tile request should not blank the whole map.
        if (event.error?.message?.includes('style')) setFailed(true);
      });

      mapRef.current = map;
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      markers.forEach((marker) => marker.remove());
      markers.clear();
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  /* ------------------------------------------------------------ markers -- */

  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const seen = new Set<string>();

    for (const location of locations) {
      seen.add(location.userId);

      const existing = markersRef.current.get(location.userId);

      if (existing) {
        // Move rather than recreate, so the marker animates and keeps focus.
        existing.setLngLat([location.longitude, location.latitude]);
        updateMarkerElement(existing.getElement(), location, location.userId === selectedUserId);
        continue;
      }

      const element = document.createElement('button');
      element.type = 'button';
      element.className = 'famlink-marker';
      element.addEventListener('click', (event) => {
        event.stopPropagation();
        onSelect?.(location.userId);
      });
      updateMarkerElement(element, location, location.userId === selectedUserId);

      const marker = new Marker({ element, anchor: 'bottom' })
        .setLngLat([location.longitude, location.latitude])
        .addTo(map);

      markersRef.current.set(location.userId, marker);
    }

    // Drop markers for anyone who stopped sharing since the last update.
    for (const [userId, marker] of markersRef.current) {
      if (!seen.has(userId)) {
        marker.remove();
        markersRef.current.delete(userId);
      }
    }

    if (!hasFitRef.current && locations.length > 0) {
      const bounds = boundsOf(locations);
      if (bounds) {
        map.fitBounds(
          [
            [bounds.west, bounds.south],
            [bounds.east, bounds.north],
          ],
          { padding: 80, maxZoom: 15, duration: 0 },
        );
        hasFitRef.current = true;
      }
    }
  }, [locations, ready, selectedUserId, onSelect]);

  /* ------------------------------------------------------- recentre on -- */

  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !selectedUserId) return;

    const target = locations.find((l) => l.userId === selectedUserId);
    if (!target) return;

    map.easeTo({
      center: [target.longitude, target.latitude],
      zoom: Math.max(map.getZoom(), 14),
      duration: 600,
    });
  }, [selectedUserId, locations, ready]);

  if (failed) {
    return (
      <div className={cn('relative grid place-items-center', className)} role="alert">
        <div className="text-center px-6">
          <p className="text-sm font-medium text-fg">Unable to load the map</p>
          <p className="text-xs text-muted mt-1">Please check your connection and try again.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('relative', className)}>
      {/*
        Sized with h-full rather than absolute inset-0: MapLibre's own
        .maplibregl-map class forces position:relative onto its container,
        which would override absolute positioning and collapse the height.
      */}
      <div
        ref={containerRef}
        className="h-full w-full"
        role="application"
        aria-label="Map of family locations"
      />

      {!ready && (
        <div className="absolute inset-0 skeleton" aria-hidden />
      )}

      <style>{MARKER_CSS}</style>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function updateMarkerElement(
  element: HTMLElement,
  location: MemberLocation,
  selected: boolean,
): void {
  const freshness = locationFreshness(location.recordedAt);
  const stale = freshness.state !== 'live';

  element.setAttribute(
    'aria-label',
    `${location.name}, ${freshness.label.toLowerCase()}`,
  );
  element.dataset.stale = String(stale);
  element.dataset.selected = String(selected);
  element.style.setProperty('--marker-color', avatarColor(location.userId));

  const avatar = location.image
    ? `<img src="${escapeHtml(location.image)}" alt="" />`
    : `<span>${escapeHtml(initials(location.name))}</span>`;

  element.innerHTML = `
    <span class="famlink-marker__pin">${avatar}</span>
    <span class="famlink-marker__name">${escapeHtml(location.name.split(' ')[0] ?? location.name)}</span>
  `;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * Marker styling.
 *
 * Inline rather than in globals.css because the markup is created imperatively
 * by MapLibre and Tailwind's scanner would never see these class names.
 */
const MARKER_CSS = `
.famlink-marker {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  background: none;
  border: 0;
  padding: 0;
  cursor: pointer;
  font-family: inherit;
}
.famlink-marker__pin {
  position: relative;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: var(--marker-color, #128472);
  border: 3px solid #fff;
  box-shadow: 0 2px 8px rgb(0 0 0 / 0.28);
  display: grid;
  place-items: center;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  transition: transform 160ms cubic-bezier(0.22, 1, 0.36, 1), filter 200ms;
}
.famlink-marker__pin img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.famlink-marker__pin::after {
  /* The pointer tip, so the marker reads as pinned to a spot. */
  content: '';
  position: absolute;
  bottom: -9px;
  width: 0;
  height: 0;
  border-left: 5px solid transparent;
  border-right: 5px solid transparent;
  border-top: 8px solid #fff;
}
.famlink-marker__name {
  margin-top: 6px;
  padding: 1px 6px;
  border-radius: 6px;
  background: rgb(0 0 0 / 0.62);
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  line-height: 16px;
  white-space: nowrap;
  backdrop-filter: blur(2px);
}
/* A stale position must never look live. */
.famlink-marker[data-stale='true'] .famlink-marker__pin {
  filter: grayscale(0.75);
  opacity: 0.72;
  border-style: dashed;
}
.famlink-marker[data-selected='true'] .famlink-marker__pin {
  transform: scale(1.14);
  box-shadow: 0 0 0 4px rgb(30 165 140 / 0.45), 0 2px 10px rgb(0 0 0 / 0.3);
}
.famlink-marker:focus-visible .famlink-marker__pin {
  outline: 3px solid #1ea58c;
  outline-offset: 3px;
}
`;

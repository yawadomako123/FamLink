'use client';

import * as React from 'react';
import { Map as MapLibreMap, NavigationControl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { resolveMapStyle } from '@/lib/location/map-style';
import { cn } from '@/lib/utils';

/**
 * Map used to position a place.
 *
 * People know where "Grandma's house" is by sight, not by coordinate, so the
 * centre of the map *is* the chosen point — drag the map, the pin stays put in
 * the middle. That avoids asking anyone to drop a marker precisely on a phone.
 *
 * The radius is drawn to scale, so the geofence being configured is visible
 * rather than an abstract number in a field.
 */
export function PlacePickerMap({
  latitude,
  longitude,
  radius,
  onMove,
  className,
}: {
  latitude: number;
  longitude: number;
  radius: number;
  onMove: (position: { latitude: number; longitude: number }) => void;
  className?: string;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<MapLibreMap | null>(null);
  const onMoveRef = React.useRef(onMove);
  const [ready, setReady] = React.useState(false);

  // Keep the latest callback without re-creating the map when it changes.
  React.useEffect(() => {
    onMoveRef.current = onMove;
  }, [onMove]);

  React.useEffect(() => {
    let map: MapLibreMap | null = null;
    let cancelled = false;

    const frame = requestAnimationFrame(() => {
      if (cancelled || !containerRef.current) return;

      map = new MapLibreMap({
        container: containerRef.current,
        style: resolveMapStyle(),
        center: [longitude, latitude],
        zoom: 15,
        attributionControl: { compact: true },
        dragRotate: false,
        pitchWithRotate: false,
      });

      map.touchZoomRotate.disableRotation();
      map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right');

      map.on('load', () => setReady(true));
      map.on('moveend', () => {
        const centre = map!.getCenter();
        onMoveRef.current({ latitude: centre.lat, longitude: centre.lng });
      });

      mapRef.current = map;
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      map?.remove();
      mapRef.current = null;
    };
    // Intentionally mounted once: latitude/longitude are the *initial* centre,
    // and reacting to them would fight the user as they drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /*
   * Draw the geofence radius to scale.
   *
   * The pixel radius is computed here rather than with a MapLibre zoom
   * expression: metres-per-pixel depends on latitude under Web Mercator
   * (a 200m circle is far more pixels at 60°N than at the equator), and
   * expressing that inline is both unreadable and easy to get wrong.
   */
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const SOURCE = 'place-radius';
    const LAYER = 'place-radius-fill';
    const EARTH_CIRCUMFERENCE_M = 40_075_016.686;
    const TILE_SIZE = 512;

    const pixelsForRadius = (latitude: number, zoom: number) => {
      const metresPerPixel =
        (EARTH_CIRCUMFERENCE_M * Math.cos((latitude * Math.PI) / 180)) /
        (TILE_SIZE * 2 ** zoom);
      return radius / metresPerPixel;
    };

    const featureAt = (lng: number, lat: number) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [lng, lat] },
      properties: {},
    });

    if (!map.getSource(SOURCE)) {
      const centre = map.getCenter();
      map.addSource(SOURCE, { type: 'geojson', data: featureAt(centre.lng, centre.lat) });
      map.addLayer({
        id: LAYER,
        type: 'circle',
        source: SOURCE,
        paint: {
          'circle-radius': pixelsForRadius(centre.lat, map.getZoom()),
          'circle-color': '#1ea58c',
          'circle-opacity': 0.18,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#128472',
          'circle-stroke-opacity': 0.75,
        },
      });
    }

    // Keep the circle pinned under the crosshair and correctly sized as the
    // map is dragged or zoomed.
    const sync = () => {
      const centre = map.getCenter();

      const source = map.getSource(SOURCE);
      if (source && 'setData' in source) {
        (source as { setData: (d: unknown) => void }).setData(
          featureAt(centre.lng, centre.lat),
        );
      }

      if (map.getLayer(LAYER)) {
        map.setPaintProperty(LAYER, 'circle-radius', pixelsForRadius(centre.lat, map.getZoom()));
      }
    };

    sync();
    map.on('move', sync);
    map.on('zoom', sync);

    return () => {
      map.off('move', sync);
      map.off('zoom', sync);
    };
  }, [radius, ready]);

  return (
    <div className={cn('relative overflow-hidden rounded-xl bg-inset', className)}>
      <div ref={containerRef} className="h-full w-full" aria-label="Choose a location" />

      {/* Fixed crosshair: the centre of the map is the chosen point. */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-full"
      >
        <svg width="30" height="38" viewBox="0 0 30 38">
          <path
            d="M15 37c0-9 11-13 11-22A11 11 0 1 0 4 15c0 9 11 13 11 22Z"
            fill="#128472"
            stroke="#fff"
            strokeWidth="2.5"
          />
          <circle cx="15" cy="15" r="4" fill="#fff" />
        </svg>
      </div>

      {!ready && <div className="absolute inset-0 skeleton" aria-hidden />}
    </div>
  );
}

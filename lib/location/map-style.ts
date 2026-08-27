import type { StyleSpecification } from 'maplibre-gl';
import { publicEnv } from '@/lib/env';

/**
 * Map style resolution.
 *
 * FamLink deliberately does not hardcode a proprietary tile provider. If
 * NEXT_PUBLIC_MAP_STYLE_URL is set, that style is used verbatim; otherwise the
 * app falls back to the OpenStreetMap raster style below so a fresh checkout
 * renders a real map with no account and no API key.
 *
 * That fallback is for development and evaluation only. The OSM Foundation's
 * tile usage policy does not permit a production application to run on their
 * public tile servers — before shipping, point NEXT_PUBLIC_MAP_STYLE_URL at
 * MapTiler, Protomaps, Stadia or a self-hosted tile server. Because the style
 * is just a URL, that swap needs no code change.
 */

const OSM_RASTER_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 19,
      // Attribution is a licence requirement, not decoration.
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  },
  layers: [
    {
      id: 'osm',
      type: 'raster',
      source: 'osm',
      minzoom: 0,
      maxzoom: 20,
    },
  ],
};

export function resolveMapStyle(): string | StyleSpecification {
  return publicEnv.mapStyleUrl || OSM_RASTER_STYLE;
}

/** True when running on the unlicensed development fallback. */
export function isUsingFallbackStyle(): boolean {
  return !publicEnv.mapStyleUrl;
}

/* -------------------------------------------------------------------------- */
/* Viewport helpers                                                            */
/* -------------------------------------------------------------------------- */

export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/**
 * Bounding box containing every supplied point.
 *
 * Returns null for an empty set so callers must decide what to show when
 * nobody is sharing, rather than being handed a meaningless default centre.
 */
export function boundsOf(points: { latitude: number; longitude: number }[]): Bounds | null {
  if (points.length === 0) return null;

  let west = 180;
  let south = 90;
  let east = -180;
  let north = -90;

  for (const { latitude, longitude } of points) {
    west = Math.min(west, longitude);
    east = Math.max(east, longitude);
    south = Math.min(south, latitude);
    north = Math.max(north, latitude);
  }

  return { west, south, east, north };
}

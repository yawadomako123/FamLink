import type { MetadataRoute } from 'next';

/**
 * PWA manifest. FamLink is installable and runs standalone, but note the
 * limitation documented in the README: an installed PWA still has no
 * unrestricted background geolocation. Location updates only flow while the
 * app is open.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'FamLink — Family safety & location',
    short_name: 'FamLink',
    description:
      'A private space for your family. Share your location on your terms, see everyone on one map, and stay in touch.',
    id: '/dashboard',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#faf9f7',
    theme_color: '#128472',
    categories: ['social', 'lifestyle', 'navigation'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Family map', short_name: 'Map', url: '/map' },
      { name: 'Family chat', short_name: 'Chat', url: '/chat' },
    ],
  };
}

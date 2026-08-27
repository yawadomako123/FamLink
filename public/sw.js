/* eslint-disable no-console -- the service worker has no other diagnostic channel */
/**
 * FamLink service worker.
 *
 * Scope is deliberately narrow. It exists to make the app shell installable and
 * to degrade gracefully offline — nothing more.
 *
 * Hard rule: no response from /api/ is ever written to a cache. Those responses
 * carry family locations, chat messages and emergency events. A stale cached
 * copy would be both a privacy leak (it would survive a sign-out on a shared
 * device) and a correctness bug (the map would show positions the server has
 * already superseded).
 */

const VERSION = 'famlink-v1';
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;

/** Cached at install so a cold offline launch still renders something. */
const SHELL_ASSETS = [
  '/offline',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Individually, so one 404 cannot fail the whole installation.
      await Promise.allSettled(SHELL_ASSETS.map((url) => cache.add(url)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

/**
 * Signing out must leave nothing behind on a shared device, so the app posts
 * this message and we drop every cache we own.
 */
self.addEventListener('message', (event) => {
  if (event.data?.type === 'CLEAR_CACHES') {
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))));
  }
});

function isApiRequest(url) {
  return url.pathname.startsWith('/api/');
}

function isStaticAsset(url) {
  return (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/manifest.webmanifest'
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Never interfere with anything but same-origin GETs.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // API traffic goes straight to the network, always. Never cached, never
  // served from a cache — see the note at the top of this file.
  if (isApiRequest(url)) return;

  // Build output is content-hashed, so it is safe to serve cache-first.
  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Navigations: try the network, fall back to the offline shell.
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
  }
});

async function cacheFirst(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    console.warn('[sw] asset fetch failed', error);
    return Response.error();
  }
}

async function networkFirstNavigation(request) {
  try {
    return await fetch(request);
  } catch {
    /*
     * Offline. Serve the offline page rather than a cached copy of the
     * requested route: a cached dashboard would show yesterday's family
     * locations as though they were current.
     */
    const cache = await caches.open(SHELL_CACHE);
    const offline = await cache.match('/offline');
    if (offline) return offline;

    return new Response('You are offline.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

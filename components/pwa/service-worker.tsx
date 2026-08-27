'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker after the page has settled, so registration
 * never competes with first paint.
 *
 * Skipped in development: an aggressively cached shell makes hot reload
 * behave in confusing ways.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((error) => {
        console.warn('Service worker registration failed', error);
      });
    };

    if (document.readyState === 'complete') {
      register();
    } else {
      window.addEventListener('load', register, { once: true });
      return () => window.removeEventListener('load', register);
    }

    return undefined;
  }, []);

  return null;
}

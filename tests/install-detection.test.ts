import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  canOfferInstall,
  detectPlatform,
  isStandalone,
  wasRecentlyDismissed,
  DISMISS_DURATION_MS,
} from '@/lib/pwa/install';

/**
 * Install platform detection.
 *
 * The bug this guards against is the one the first implementation had: a
 * prompt built only on `beforeinstallprompt` is invisible on iOS, because
 * Apple has never fired that event. For a family app that lives on phones,
 * silently showing nothing to every iPhone user is a serious miss — and it
 * fails quietly, which is why it needs a test rather than a look.
 */

/** Stubs the browser globals detection reads. */
function stubEnvironment({
  userAgent,
  standalone = false,
  displayMode = false,
  maxTouchPoints = 0,
}: {
  userAgent: string;
  standalone?: boolean;
  displayMode?: boolean;
  maxTouchPoints?: number;
}) {
  vi.stubGlobal('window', {
    matchMedia: (query: string) => ({
      matches: query.includes('standalone') ? displayMode : false,
    }),
    navigator: { userAgent, standalone },
  });

  vi.stubGlobal('navigator', { userAgent, standalone, maxTouchPoints });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1';

const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';

const DESKTOP_CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const IPADOS_SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

describe('detectPlatform', () => {
  it('offers instructions on iOS Safari, where no prompt event exists', () => {
    stubEnvironment({ userAgent: IPHONE_SAFARI });

    // The whole point: iOS never fires beforeinstallprompt, so detection must
    // not depend on it.
    expect(detectPlatform(false)).toBe('ios-safari');
  });

  it('tells non-Safari iOS browsers to switch, rather than to tap Share', () => {
    stubEnvironment({ userAgent: IPHONE_CHROME });

    // Chrome on iOS has no Add to Home Screen item, so "tap Share" would send
    // somebody looking for a button that is not there.
    expect(detectPlatform(false)).toBe('ios-other');
  });

  it('recognises iPadOS, which reports itself as a Mac', () => {
    stubEnvironment({ userAgent: IPADOS_SAFARI, maxTouchPoints: 5 });

    expect(detectPlatform(false)).toBe('ios-safari');
  });

  it('does not mistake a real Mac for an iPad', () => {
    stubEnvironment({ userAgent: IPADOS_SAFARI, maxTouchPoints: 0 });

    expect(detectPlatform(false)).toBe('unsupported');
  });

  it('uses the native prompt when the browser offers one', () => {
    stubEnvironment({ userAgent: ANDROID_CHROME });

    expect(detectPlatform(true)).toBe('prompt');
  });

  it('shows nothing on Android until the browser offers a prompt', () => {
    stubEnvironment({ userAgent: ANDROID_CHROME });

    // A dead Install button is worse than no button.
    expect(detectPlatform(false)).toBe('unsupported');
  });

  it('shows nothing once already installed', () => {
    stubEnvironment({ userAgent: IPHONE_SAFARI, standalone: true });
    expect(detectPlatform(false)).toBe('installed');

    stubEnvironment({ userAgent: ANDROID_CHROME, displayMode: true });
    expect(detectPlatform(true)).toBe('installed');
  });

  it('offers nothing on desktop', () => {
    stubEnvironment({ userAgent: DESKTOP_CHROME });
    expect(detectPlatform(false)).toBe('unsupported');
  });
});

describe('isStandalone', () => {
  it('detects the iOS non-standard property as well as the media query', () => {
    stubEnvironment({ userAgent: IPHONE_SAFARI, standalone: true });
    expect(isStandalone()).toBe(true);

    stubEnvironment({ userAgent: ANDROID_CHROME, displayMode: true });
    expect(isStandalone()).toBe(true);

    stubEnvironment({ userAgent: ANDROID_CHROME });
    expect(isStandalone()).toBe(false);
  });
});

describe('canOfferInstall', () => {
  it('covers every platform where showing something helps', () => {
    expect(canOfferInstall('prompt')).toBe(true);
    expect(canOfferInstall('ios-safari')).toBe(true);
    expect(canOfferInstall('ios-other')).toBe(true);

    expect(canOfferInstall('installed')).toBe(false);
    expect(canOfferInstall('unsupported')).toBe(false);
  });
});

describe('dismissal', () => {
  const store = new Map<string, string>();

  function stubStorage() {
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
  }

  it('suppresses the banner for a while, then offers again', () => {
    store.clear();
    stubStorage();

    const now = Date.now();
    store.set('famlink:install-dismissed', String(now));

    expect(wasRecentlyDismissed(now + 1000)).toBe(true);

    // A banner that never returns never converts; one that returns every
    // visit is nagging.
    expect(wasRecentlyDismissed(now + DISMISS_DURATION_MS + 1)).toBe(false);
  });

  it('shows the banner when storage is unavailable', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });

    // Private mode should not silently suppress the offer.
    expect(wasRecentlyDismissed()).toBe(false);
  });
});

/**
 * Install platform detection.
 *
 * The awkward fact this exists for: **iOS Safari never fires
 * `beforeinstallprompt`**. Apple has not implemented it, and shows no sign of
 * doing so. A PWA install prompt built only on that event is therefore
 * invisible to every iPhone user — which, for a family safety app people will
 * mostly run on phones, is most of the audience.
 *
 * There is no API to trigger the iOS "Add to Home Screen" flow either, so the
 * only honest option is to tell somebody where the button is. That means
 * detecting the platform and showing the right instructions, which is what
 * this module is for.
 */

export type InstallPlatform =
  /** Chromium: a real prompt is available via beforeinstallprompt. */
  | 'prompt'
  /** iOS Safari: instructions only — Share → Add to Home Screen. */
  | 'ios-safari'
  /** iOS in a non-Safari browser: cannot install at all; must open Safari. */
  | 'ios-other'
  /** Already running as an installed app. */
  | 'installed'
  /** Desktop or anything else that cannot usefully install. */
  | 'unsupported';

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;

  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS uses a non-standard property rather than the media query.
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function detectPlatform(hasDeferredPrompt: boolean): InstallPlatform {
  if (typeof window === 'undefined') return 'unsupported';
  if (isStandalone()) return 'installed';

  const ua = window.navigator.userAgent;

  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS 13+ reports itself as a Mac; the touch points give it away.
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);

  if (isIOS) {
    /*
     * Only Safari can add to the home screen on iOS. Every other iOS browser
     * is WebKit underneath but lacks the menu item, so telling a Chrome-on-iOS
     * user to "tap Share" would send them looking for a button that is not
     * there.
     */
    const isSafari =
      /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|Chrome/.test(ua);

    return isSafari ? 'ios-safari' : 'ios-other';
  }

  if (hasDeferredPrompt) return 'prompt';

  // Android Chrome sometimes withholds the event until its own heuristics are
  // satisfied; a mobile device with a service worker can still install later.
  const isAndroid = /Android/.test(ua);
  return isAndroid ? 'unsupported' : 'unsupported';
}

/** Whether this platform is worth showing a banner for at all. */
export function canOfferInstall(platform: InstallPlatform): boolean {
  return platform === 'prompt' || platform === 'ios-safari' || platform === 'ios-other';
}

export const DISMISSED_KEY = 'famlink:install-dismissed';

/**
 * Dismissal is remembered per device, and re-offered after this long.
 *
 * Somebody who said "not now" on their laptop may well want it on their phone
 * later, and a banner that never returns is a banner that never converts —
 * but one that returns every visit is just nagging.
 */
export const DISMISS_DURATION_MS = 14 * 24 * 60 * 60 * 1000;

export function wasRecentlyDismissed(now: number = Date.now()): boolean {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    if (!raw) return false;

    const at = Number(raw);
    // Legacy value from before timestamps: treat as dismissed forever ago.
    if (!Number.isFinite(at)) return false;

    return now - at < DISMISS_DURATION_MS;
  } catch {
    // Blocked storage: better to show it than to suppress it silently.
    return false;
  }
}

export function rememberDismissal(now: number = Date.now()): void {
  try {
    localStorage.setItem(DISMISSED_KEY, String(now));
  } catch {
    // Not being able to remember is not worth surfacing to anyone.
  }
}

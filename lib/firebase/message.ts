import type { Message } from 'firebase-admin/messaging';

/**
 * Builds the FCM payload for one push.
 *
 * ## Why this is data-only
 *
 * An FCM message carrying a `notification` block is displayed by the Firebase
 * service worker automatically *and* handed to `onBackgroundMessage`. A worker
 * that draws its own notification there — which ours must, to set the tag that
 * collapses a chat thread — therefore produces a second one. Every push
 * arrived twice.
 *
 * Sending data only makes the service worker the single author of what appears.
 * Nothing displays a notification except the code in
 * `public/firebase-messaging-sw.js`, so there is exactly one.
 *
 * The cost is that a browser with no service worker running shows nothing at
 * all, where a `notification` block would have been displayed for free. That
 * is the right trade for a PWA that ships its own worker, and it is the only
 * arrangement in which the tag works.
 *
 * Separated from `./server` so it can be tested without initialising the
 * Firebase Admin SDK.
 */

/** How long FCM should keep trying, in seconds. A day; after that it is stale news. */
const TTL_SECONDS = 86_400;

export function buildPushMessage({
  token,
  title,
  body,
  data,
  tag,
}: {
  token: string;
  title: string;
  body: string;
  data?: Record<string, string> | undefined;
  /**
   * Groups notifications that supersede one another. A family group chat sends
   * one push per message, and a stack of eleven "Ama: ok" is how somebody ends
   * up turning notifications off.
   */
  tag?: string | undefined;
}): Message {
  return {
    token,

    /*
     * Title and body travel in `data` because there is no `notification` block
     * to carry them. Every value in an FCM data payload must be a string.
     */
    data: {
      ...(data ?? {}),
      title,
      body,
      ...(tag ? { tag } : {}),
    },

    webpush: {
      headers: {
        // Family messages and alerts are time-sensitive; do not let them be
        // batched behind a low-priority queue.
        Urgency: 'high',
        TTL: String(TTL_SECONDS),
      },
    },

    // Harmless for web, and correct if a native client is ever added.
    ...(tag ? { android: { collapseKey: tag } } : {}),
  };
}

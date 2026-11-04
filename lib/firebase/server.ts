import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { buildPushMessage } from './message';

if (!getApps().length) {
  try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
      initializeApp({
        credential: cert(serviceAccount),
      });
    } else {
      console.warn('FIREBASE_SERVICE_ACCOUNT_JSON is not set. Firebase Admin is not initialized.');
    }
  } catch (error) {
    console.error('Firebase admin initialization error', error);
  }
}

export const adminMessaging = getApps().length ? getMessaging() : null;

/**
 * What became of one push.
 *
 * `gone` is the one worth distinguishing: FCM is telling us this token will
 * never deliver again, so the row should go rather than being retried on
 * every family notification for ever.
 */
export type PushOutcome = 'sent' | 'failed' | 'gone';

/**
 * Error codes that mean the token itself is finished.
 *
 * Deliberately narrow. `messaging/invalid-argument` is *not* here: FCM uses
 * it for a malformed payload as well as a malformed token, so treating it as
 * a dead token would let one bad payload silently unsubscribe every device it
 * was sent to. A token that is genuinely unusable shows up as one of these
 * two, and anything ambiguous is left alone — a token kept by mistake costs a
 * wasted call, a token deleted by mistake costs somebody their alerts.
 */
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

/** Whether FCM is reporting a token that can be retired. */
export function isDeadTokenError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && DEAD_TOKEN_CODES.has(code);
}

export async function sendPushNotification(
  token: string,
  title: string,
  body: string,
  data?: Record<string, string>,
  /** Groups pushes that replace one another in the tray. See buildPushMessage. */
  tag?: string,
): Promise<PushOutcome> {
  if (!adminMessaging) {
    console.warn('Firebase Admin Messaging is not available.');
    return 'failed';
  }

  try {
    await adminMessaging.send(buildPushMessage({ token, title, body, data, tag }));
    return 'sent';
  } catch (error) {
    if (isDeadTokenError(error)) {
      // Not logged as an error: a device that was uninstalled or whose token
      // rotated is ordinary, and the caller retires the row.
      return 'gone';
    }

    console.error('Error sending push notification:', error);
    return 'failed';
  }
}

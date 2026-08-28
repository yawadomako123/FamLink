import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getMessaging, Message } from 'firebase-admin/messaging';

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

export async function sendPushNotification(
  token: string,
  title: string,
  body: string,
  data?: Record<string, string>,
  /**
   * Groups notifications that supersede one another.
   *
   * A family group chat sends one of these per message, and a stack of eleven
   * "Ama: ok" is how a person ends up turning notifications off. Sharing a tag
   * makes each new one replace the last, so the tray holds the latest rather
   * than the history.
   */
  tag?: string,
) {
  if (!adminMessaging) {
    console.warn('Firebase Admin Messaging is not available.');
    return false;
  }

  try {
    const message: Message = {
      token,
      notification: {
        title,
        body,
      },
      /*
       * The tag is repeated inside `data` on purpose. A service worker that
       * handles onBackgroundMessage builds its own notification options, so
       * the webpush tag below never reaches it — it has to read it from here.
       */
      data: tag ? { ...(data ?? {}), tag } : data,
      ...(tag
        ? {
            android: { collapseKey: tag, notification: { tag } },
            webpush: { notification: { tag, renotify: true } },
          }
        : {}),
    };
    await adminMessaging.send(message);
    return true;
  } catch (error) {
    console.error('Error sending push notification:', error);
    return false;
  }
}

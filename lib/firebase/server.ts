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

export async function sendPushNotification(
  token: string,
  title: string,
  body: string,
  data?: Record<string, string>,
  /** Groups pushes that replace one another in the tray. See buildPushMessage. */
  tag?: string,
) {
  if (!adminMessaging) {
    console.warn('Firebase Admin Messaging is not available.');
    return false;
  }

  try {
    await adminMessaging.send(buildPushMessage({ token, title, body, data, tag }));
    return true;
  } catch (error) {
    console.error('Error sending push notification:', error);
    return false;
  }
}

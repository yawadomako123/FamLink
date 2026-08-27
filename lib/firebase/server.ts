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

export async function sendPushNotification(token: string, title: string, body: string, data?: Record<string, string>) {
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
      data,
    };
    await adminMessaging.send(message);
    return true;
  } catch (error) {
    console.error('Error sending push notification:', error);
    return false;
  }
}

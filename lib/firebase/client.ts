import { initializeApp, getApps, getApp } from 'firebase/app';
import { getMessaging, getToken, isSupported } from 'firebase/messaging';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Initialize Firebase
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

/**
 * Registers this device for push, asking only if `prompt` allows it.
 *
 * The split matters. This used to prompt unconditionally, and was called two
 * seconds after the app first loaded — before anybody had seen what FamLink
 * was for. A browser remembers a refusal more or less permanently, so an
 * unexplained prompt was the fastest way to lose push on that device for
 * good, and push is how an SOS reaches a phone that is in somebody's pocket.
 *
 * On load the token is now only refreshed for a device that has *already*
 * granted. Asking happens when somebody presses the button in settings.
 */
const getFcmToken = async (prompt: boolean): Promise<string | null> => {
  try {
    const supported = await isSupported();
    if (!supported) {
      console.warn('Firebase Messaging is not supported in this browser.');
      return null;
    }

    if (typeof Notification === 'undefined') return null;

    // Nothing to gain from asking again, and the browser would not show it.
    if (Notification.permission === 'denied') return null;
    if (Notification.permission !== 'granted' && !prompt) return null;

    const messaging = getMessaging(app);
    const permission =
      Notification.permission === 'granted'
        ? 'granted'
        : await Notification.requestPermission();

    if (permission === 'granted') {
      const currentToken = await getToken(messaging, {
        vapidKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY,
      });

      if (currentToken) {
        return currentToken;
      } else {
        console.warn('No registration token available. Request permission to generate one.');
      }
    } else {
      console.warn('Notification permission denied by user.');
    }
  } catch (err) {
    console.error('An error occurred while retrieving token. ', err);
  }
  return null;
};

/**
 * Sends the device's push token to the server.
 *
 * Shared by both callers so the endpoint and its failure handling live in one
 * place rather than being repeated at each call site.
 */
async function saveToken(token: string): Promise<void> {
  await fetch('/api/v1/fcm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, userAgent: navigator.userAgent }),
  });
}

/** Refreshes the token for a device that has already granted. Never asks. */
export async function syncExistingPushToken(): Promise<void> {
  const token = await getFcmToken(false);
  if (!token) return;

  try {
    await saveToken(token);
  } catch (error) {
    console.error('Failed to save FCM token to backend', error);
  }
}

/** Asks for permission, then registers. Only ever from a deliberate action. */
export async function registerForPush(): Promise<string | null> {
  const token = await getFcmToken(true);
  if (!token) return null;

  await saveToken(token);
  return token;
}

export { app };

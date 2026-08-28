// Firebase service worker for push notifications
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

// These will be injected or loaded from environment variables in a real deployment.
// For now, these are placeholders that the user must replace with their actual Firebase config.
const firebaseConfig = {
  apiKey: "AIzaSyCuQmKZuSUPk4Oh-rOzVJD3LKYfrxicFlg",
  authDomain: "famlink-3e7a8.firebaseapp.com",
  projectId: "famlink-3e7a8",
  storageBucket: "famlink-3e7a8.firebasestorage.app",
  messagingSenderId: "199883680132",
  appId: "1:199883680132:web:a831a707030d30efcb15d1"
};

// Only initialize if the config has been updated.
if (firebaseConfig.apiKey !== "REPLACE_WITH_YOUR_API_KEY") {
  firebase.initializeApp(firebaseConfig);
  const messaging = firebase.messaging();

  messaging.onBackgroundMessage((payload) => {
    const notificationTitle = payload.notification?.title || 'FamLink';
    const notificationOptions = {
      body: payload.notification?.body,
      icon: '/icon512_rounded.png',
      data: payload.data,
      // Chat sends one of these per message. Sharing a tag makes each replace
      // the last, so a busy thread leaves one entry rather than twenty.
      tag: payload.data?.tag,
      renotify: Boolean(payload.data?.tag)
    };

    self.registration.showNotification(notificationTitle, notificationOptions);
  });
}

/*
 * Tapping a notification should land on the thing it is about.
 *
 * Registered outside the config guard: it costs nothing when no notification
 * was ever shown, and previously a tap did nothing at all — the notification
 * closed and the app stayed wherever it was.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const target = data.url || (String(data.tag || '').startsWith('chat:') ? '/chat' : '/alerts');

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Prefer a tab that is already open, so the tray does not spawn windows.
      for (const client of clients) {
        if ('focus' in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});

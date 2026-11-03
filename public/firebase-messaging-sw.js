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

  /**
   * Whether a wall-clock window covers this moment, on this device.
   *
   * Quiet hours cannot be applied on the server: it is a wall-clock window and
   * the server knows nobody's timezone, so 22:00 means nothing to it. Here it
   * does — this runs on the device — so the window travels in the payload and
   * the decision is made against local time.
   *
   * A window like 22:00-07:00 wraps past midnight, so both orderings are
   * handled rather than assuming start < end.
   */
  const inQuietHours = (startMinutes, endMinutes) => {
    const now = new Date();
    const minutes = now.getHours() * 60 + now.getMinutes();

    return startMinutes < endMinutes
      ? minutes >= startMinutes && minutes < endMinutes
      : minutes >= startMinutes || minutes < endMinutes;
  };

  /*
   * The single author of anything the user sees.
   *
   * Pushes are sent data-only on purpose: a message carrying a `notification`
   * block is auto-displayed by the SDK *and* delivered here, so drawing one
   * here as well produced two notifications for every push. Title and body
   * therefore arrive in `data`.
   *
   * `payload.notification` is still read as a fallback, so a push sent by an
   * older deployment — or sitting queued from before it — is not silent.
   */
  messaging.onBackgroundMessage((payload) => {
    const data = payload.data || {};

    /*
     * Quiet hours suppress the interruption, not the record. The in-app
     * notification was written server-side either way, so it is waiting in
     * Alerts in the morning — this only declines to wake somebody for it.
     *
     * These fields are absent entirely for an SOS, which is why no exception
     * is needed here: an emergency is never silenceable, so it never carries a
     * window to be silenced by.
     */
    const quietStart = Number(data.quietStart);
    const quietEnd = Number(data.quietEnd);

    if (
      Number.isFinite(quietStart) &&
      Number.isFinite(quietEnd) &&
      inQuietHours(quietStart, quietEnd)
    ) {
      return;
    }

    const notificationTitle = data.title || payload.notification?.title || 'FamLink';
    const notificationOptions = {
      body: data.body || payload.notification?.body || '',
      icon: '/icon512_rounded.png',
      data: data,
      // Chat sends one of these per message. Sharing a tag makes each replace
      // the last, so a busy thread leaves one entry rather than twenty.
      tag: data.tag,
      renotify: Boolean(data.tag)
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

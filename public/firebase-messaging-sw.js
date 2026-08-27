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
    console.log('[firebase-messaging-sw.js] Received background message ', payload);
    const notificationTitle = payload.notification?.title || 'FamLink';
    const notificationOptions = {
      body: payload.notification?.body,
      icon: '/icon512_rounded.png',
      data: payload.data
    };

    self.registration.showNotification(notificationTitle, notificationOptions);
  });
}

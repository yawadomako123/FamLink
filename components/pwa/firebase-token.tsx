'use client';

import * as React from 'react';
import { requestFirebaseNotificationPermission } from '@/lib/firebase/client';

export function FirebaseToken() {
  React.useEffect(() => {
    async function setupFirebaseToken() {
      const token = await requestFirebaseNotificationPermission();
      if (token) {
        try {
          await fetch('/api/v1/fcm', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ token, userAgent: navigator.userAgent }),
          });
        } catch (error) {
          console.error('Failed to save FCM token to backend', error);
        }
      }
    }
    
    // Delay token request slightly so it doesn't block critical page load
    const timeoutId = setTimeout(() => {
      setupFirebaseToken();
    }, 2000);
    
    return () => clearTimeout(timeoutId);
  }, []);

  return null;
}

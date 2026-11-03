'use client';

import * as React from 'react';
import { syncExistingPushToken } from '@/lib/firebase/client';

/**
 * Keeps this device's push token current.
 *
 * Refreshes only — it never asks for permission. FCM rotates tokens, and a
 * device that has already said yes needs its new one reaching the server or it
 * quietly stops receiving anything.
 *
 * It used to ask, two seconds after the app first loaded, before anybody had
 * seen what FamLink was for. A browser remembers a refusal more or less
 * permanently, so that prompt was the fastest way to lose push on a device for
 * good — and push is how an SOS reaches a phone in somebody's pocket. Asking
 * now happens in settings, where there is room to say what it is for.
 */
export function FirebaseToken() {
  React.useEffect(() => {
    // Deferred so it never competes with first paint.
    const timeoutId = setTimeout(() => void syncExistingPushToken(), 2000);
    return () => clearTimeout(timeoutId);
  }, []);

  return null;
}

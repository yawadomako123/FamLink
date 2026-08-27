'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { signOut } from '@/lib/auth/client';

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);

  async function handleSignOut() {
    setPending(true);
    await signOut();

    /*
     * Drop every cached response before leaving. On a shared device the app
     * shell should not survive a sign-out.
     */
    try {
      navigator.serviceWorker?.controller?.postMessage({ type: 'CLEAR_CACHES' });
    } catch {
      // Not fatal — the worker may not be registered in this environment.
    }

    router.push('/login');
    router.refresh();
  }

  return (
    <Button variant="outline" fullWidth loading={pending} onClick={() => void handleSignOut()}>
      <LogOut aria-hidden className="size-4" />
      Log out
    </Button>
  );
}

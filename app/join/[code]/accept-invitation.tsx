'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { api, errorMessage } from '@/lib/api/client';

export function AcceptInvitation({
  code,
  familyName,
  className,
}: {
  code: string;
  familyName: string;
  className?: string;
}) {
  const router = useRouter();
  const [joining, setJoining] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function join() {
    setJoining(true);
    setError(null);

    try {
      await api.post('/api/v1/invitations/accept', { code });
      router.push('/dashboard');
      router.refresh();
    } catch (err) {
      // The invitation may have been used or revoked while this page was open,
      // so surface the server's reason rather than retrying blindly.
      setError(errorMessage(err));
      setJoining(false);
    }
  }

  return (
    <div className={className}>
      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}

      <Button size="lg" fullWidth loading={joining} onClick={() => void join()}>
        Join {familyName}
      </Button>

      <Link href="/dashboard" className="block mt-2">
        <Button variant="ghost" size="lg" fullWidth disabled={joining}>
          Not now
        </Button>
      </Link>
    </div>
  );
}

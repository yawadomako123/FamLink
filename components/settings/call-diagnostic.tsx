'use client';

import * as React from 'react';
import { CheckCircle2, Loader2, ShieldAlert, TriangleAlert, Wifi } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api, errorMessage } from '@/lib/api/client';
import type { IceConfig } from '@/lib/calls/ice';
import { cn } from '@/lib/utils';

/**
 * Call connectivity check.
 *
 * Configuring TURN is not the same as TURN working — a wrong shared secret, a
 * blocked port or an unreachable host all look identical from the settings
 * page. This actually gathers ICE candidates and reports which kinds the
 * browser managed to obtain:
 *
 *   host   — this machine's own addresses. Always present.
 *   srflx  — a public address discovered via STUN. Direct connections work.
 *   relay  — an allocation on the TURN server. Calls work even with no direct
 *            path, which is the case that fails without a relay.
 *
 * A relay candidate is proof the credentials were accepted, because the server
 * refuses to allocate one otherwise.
 */

type Result = {
  host: boolean;
  srflx: boolean;
  relay: boolean;
  hasRelayConfigured: boolean;
  error?: string;
};

/** ICE gathering settles quickly on a healthy network. */
const GATHER_TIMEOUT_MS = 8_000;

export function CallDiagnostic() {
  const [running, setRunning] = React.useState(false);
  const [result, setResult] = React.useState<Result | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const run = React.useCallback(async () => {
    setRunning(true);
    setError(null);
    setResult(null);

    try {
      // Any family works — ICE config is per user, not per family.
      const families = await api.get<{ families: { id: string }[] }>('/api/v1/families');
      const familyId = families.families[0]?.id;

      if (!familyId) {
        setError('Join a family first — call settings are per family.');
        return;
      }

      const { ice } = await api.get<{ ice: IceConfig }>(
        `/api/v1/families/${familyId}/calls`,
      );

      const found = await gatherCandidates(ice);
      setResult({ ...found, hasRelayConfigured: ice.hasRelay });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setRunning(false);
    }
  }, []);

  return (
    <Card>
      <CardHeader className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <CardTitle>Call connectivity</CardTitle>
          <p className="text-sm text-muted mt-1 leading-relaxed">
            Checks whether this device can actually establish a call, including
            through a relay when a direct connection isn&rsquo;t possible.
          </p>
        </div>
        <Button size="sm" variant="secondary" loading={running} onClick={() => void run()}>
          {result ? 'Test again' : 'Run test'}
        </Button>
      </CardHeader>

      {(running || result || error) && (
        <CardContent className="pt-0">
          {running && (
            <p className="flex items-center gap-2 text-sm text-muted">
              <Loader2 aria-hidden className="size-4 animate-spin" />
              Gathering network candidates…
            </p>
          )}

          {error && (
            <p role="alert" className="text-sm text-danger-600">
              {error}
            </p>
          )}

          {result && (
            <div className="space-y-2">
              <Check
                ok={result.host}
                label="This device"
                detail="Local network addresses found."
              />
              <Check
                ok={result.srflx}
                label="Direct connections (STUN)"
                detail={
                  result.srflx
                    ? 'Your public address was discovered. Most calls will connect directly.'
                    : 'No public address discovered. Calls will depend entirely on a relay.'
                }
              />
              <Check
                ok={result.relay}
                label="Relay (TURN)"
                warn={!result.hasRelayConfigured}
                detail={
                  result.relay
                    ? 'The relay accepted your credentials. Calls will connect even on restrictive networks.'
                    : result.hasRelayConfigured
                      ? 'A relay is configured but no allocation was obtained. Check the shared secret, host and firewall.'
                      : 'No relay is configured. Calls will fail on roughly 15–20% of networks — mobile data and office Wi-Fi especially.'
                }
              />

              <div
                className={cn(
                  'flex gap-2.5 rounded-xl border px-3.5 py-3 mt-3 text-sm',
                  result.relay
                    ? 'bg-tint-brand text-on-tint-brand border-line-brand'
                    : 'bg-tint-warn text-on-tint-warn border-line-warn',
                )}
              >
                {result.relay ? (
                  <CheckCircle2 aria-hidden className="size-4 shrink-0 mt-0.5" />
                ) : (
                  <ShieldAlert aria-hidden className="size-4 shrink-0 mt-0.5" />
                )}
                <span className="leading-relaxed">
                  {result.relay
                    ? 'Calls are fully configured on this deployment.'
                    : 'Calls will work for most people but not everyone. Set TURN_URL and TURN_STATIC_AUTH_SECRET to close the gap.'}
                </span>
              </div>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

function Check({
  ok,
  warn,
  label,
  detail,
}: {
  ok: boolean;
  warn?: boolean;
  label: string;
  detail: string;
}) {
  const Icon = ok ? CheckCircle2 : warn ? TriangleAlert : Wifi;

  return (
    <div className="flex gap-2.5">
      <Icon
        aria-hidden
        className={cn(
          'size-4 shrink-0 mt-0.5',
          ok ? 'text-on-tint-brand' : warn ? 'text-on-tint-warn' : 'text-danger-600',
        )}
      />
      <div className="min-w-0">
        <p className="text-sm font-medium text-fg">{label}</p>
        <p className="text-xs text-muted mt-0.5 leading-relaxed">{detail}</p>
      </div>
    </div>
  );
}

/**
 * Gathers ICE candidates and reports which kinds were obtained.
 *
 * A data channel is opened purely to make the browser start gathering — a peer
 * connection with no media and no channel has nothing to negotiate and emits
 * nothing.
 */
async function gatherCandidates(
  ice: IceConfig,
): Promise<{ host: boolean; srflx: boolean; relay: boolean }> {
  const found = { host: false, srflx: false, relay: false };

  const connection = new RTCPeerConnection({
    iceServers: ice.iceServers,
    // Without this the browser may stop early once it has a direct path, and
    // never try the relay at all — which is precisely what we came to test.
    iceCandidatePoolSize: 1,
  });

  try {
    connection.createDataChannel('probe');

    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, GATHER_TIMEOUT_MS);

      connection.onicecandidate = (event) => {
        if (!event.candidate) {
          // Null candidate signals gathering is complete.
          clearTimeout(timer);
          resolve();
          return;
        }

        const type = event.candidate.type;
        if (type === 'host') found.host = true;
        if (type === 'srflx') found.srflx = true;
        if (type === 'relay') found.relay = true;

        // Nothing more to learn once a relay allocation succeeded.
        if (found.relay) {
          clearTimeout(timer);
          resolve();
        }
      };

      void connection
        .createOffer()
        .then((offer) => connection.setLocalDescription(offer))
        .catch(() => {
          clearTimeout(timer);
          resolve();
        });
    });
  } finally {
    connection.close();
  }

  return found;
}

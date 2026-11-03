import 'server-only';

import { Client } from 'pg';
import { unpooledDatabaseUrl } from '@/lib/env';
import { REALTIME_CHANNEL, isRealtimeEvent, type RealtimeEvent } from './events';

/**
 * Postgres LISTEN subscription, shared by every SSE connection in this process.
 *
 * Two things make this non-obvious:
 *
 * 1. **It must use the unpooled connection.** PgBouncer in transaction mode
 *    hands a different backend to each statement, so a `LISTEN` issued on one
 *    is simply lost. Neon's pooled endpoint is PgBouncer, which is why
 *    `DATABASE_URL_UNPOOLED` exists and is required.
 *
 * 2. **One listener, many subscribers.** A dedicated Postgres connection per
 *    open browser tab would exhaust Neon's connection budget quickly. This
 *    module keeps a single LISTEN connection and fans out in-process.
 *
 * The connection is created lazily on the first subscriber and torn down when
 * the last one leaves, so an idle serverless instance holds nothing open.
 */

type Subscriber = (event: RealtimeEvent) => void;

/** Called when the LISTEN connection drops, so a stream can close itself. */
type LostHandler = () => void;

interface Hub {
  client: Client | null;
  connecting: Promise<void> | null;
  subscribers: Set<Subscriber>;
  /** Parallel to `subscribers`; keyed by the same filtered function. */
  lost: Map<Subscriber, LostHandler>;
}

// Cached on globalThis so Next's dev-mode module reloading cannot leak
// connections on every edit.
const globalForHub = globalThis as unknown as { __famlinkHub?: Hub };

const hub: Hub = globalForHub.__famlinkHub ?? {
  client: null,
  connecting: null,
  subscribers: new Set(),
  lost: new Map(),
};

if (process.env.NODE_ENV !== 'production') {
  globalForHub.__famlinkHub = hub;
}

async function ensureConnected(): Promise<void> {
  if (hub.client) return;
  if (hub.connecting) return hub.connecting;

  hub.connecting = (async () => {
    const url = unpooledDatabaseUrl();
    const isLocal = url.includes('localhost') || url.includes('127.0.0.1');

    const client = new Client({
      connectionString: url,
      ssl: isLocal ? false : { rejectUnauthorized: true },
    });

    client.on('notification', (message) => {
      if (message.channel !== REALTIME_CHANNEL || !message.payload) return;

      let parsed: unknown;
      try {
        parsed = JSON.parse(message.payload);
      } catch {
        return;
      }

      if (!isRealtimeEvent(parsed)) return;

      for (const subscriber of hub.subscribers) {
        try {
          subscriber(parsed);
        } catch (error) {
          // One bad subscriber must not stop delivery to the rest.
          console.error('[realtime] subscriber threw', error);
        }
      }
    });

    /*
     * A dropped LISTEN used to be silent to everybody already connected.
     *
     * The client was nulled so the *next* subscriber would reconnect, but
     * every stream already open kept its HTTP connection — healthy, reporting
     * live, and receiving nothing, because the Postgres end of it was gone.
     * Streams cycle every four minutes, so it recovered on its own, but four
     * minutes of a realtime channel that carries incoming calls is a long
     * time to be quietly dead.
     *
     * Dropping the connection now tells every subscriber, so each stream
     * closes and its browser reconnects immediately — which is also what
     * brings the LISTEN back up.
     */
    const drop = (reason: string) => {
      if (hub.client !== client) return;
      hub.client = null;

      const handlers = [...hub.lost.values()];
      hub.subscribers.clear();
      hub.lost.clear();

      if (handlers.length > 0) {
        console.warn(`[realtime] ${reason}; closing ${handlers.length} stream(s) to reconnect`);
      }

      for (const onLost of handlers) {
        try {
          onLost();
        } catch (error) {
          console.error('[realtime] lost handler threw', error);
        }
      }

      void client.end().catch(() => {});
    };

    client.on('error', (error) => {
      console.error('[realtime] listen connection error', error.message);
      drop('listen connection errored');
    });

    client.on('end', () => drop('listen connection ended'));

    await client.connect();
    await client.query(`LISTEN ${REALTIME_CHANNEL}`);

    hub.client = client;
  })();

  try {
    await hub.connecting;
  } finally {
    hub.connecting = null;
  }
}

async function disconnectIfIdle(): Promise<void> {
  if (hub.subscribers.size > 0 || !hub.client) return;

  const client = hub.client;
  hub.client = null;

  try {
    await client.end();
  } catch {
    // Already gone; nothing to do.
  }
}

/**
 * Subscribes to events for one family.
 *
 * Filtering happens here rather than in the database: `NOTIFY` is a broadcast,
 * so every listener sees every family's hints. Since events carry no payload
 * (see ./events), the only thing being filtered is which families a connection
 * is told about — but doing it here keeps that boundary explicit.
 *
 * Returns an unsubscribe function that must be called when the stream closes.
 */
export async function subscribeToFamily(
  familyId: string,
  onEvent: Subscriber,
  /**
   * Invoked if the shared LISTEN connection drops. The stream should close so
   * the browser reconnects, which is what re-establishes the subscription.
   */
  onLost?: LostHandler,
): Promise<() => void> {
  const filtered: Subscriber = (event) => {
    if (event.familyId === familyId) onEvent(event);
  };

  hub.subscribers.add(filtered);
  if (onLost) hub.lost.set(filtered, onLost);

  try {
    await ensureConnected();
  } catch (error) {
    hub.subscribers.delete(filtered);
    hub.lost.delete(filtered);
    throw error;
  }

  return () => {
    hub.subscribers.delete(filtered);
    hub.lost.delete(filtered);
    void disconnectIfIdle();
  };
}

/** Diagnostics, used by tests. */
export function subscriberCount(): number {
  return hub.subscribers.size;
}

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

interface Hub {
  client: Client | null;
  connecting: Promise<void> | null;
  subscribers: Set<Subscriber>;
}

// Cached on globalThis so Next's dev-mode module reloading cannot leak
// connections on every edit.
const globalForHub = globalThis as unknown as { __famlinkHub?: Hub };

const hub: Hub = globalForHub.__famlinkHub ?? {
  client: null,
  connecting: null,
  subscribers: new Set(),
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

    client.on('error', (error) => {
      console.error('[realtime] listen connection error', error.message);
      // Drop the client so the next subscriber reconnects rather than
      // attaching to a dead socket.
      hub.client = null;
    });

    client.on('end', () => {
      hub.client = null;
    });

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
): Promise<() => void> {
  const filtered: Subscriber = (event) => {
    if (event.familyId === familyId) onEvent(event);
  };

  hub.subscribers.add(filtered);

  try {
    await ensureConnected();
  } catch (error) {
    hub.subscribers.delete(filtered);
    throw error;
  }

  return () => {
    hub.subscribers.delete(filtered);
    void disconnectIfIdle();
  };
}

/** Diagnostics, used by tests. */
export function subscriberCount(): number {
  return hub.subscribers.size;
}

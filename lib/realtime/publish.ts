import 'server-only';

import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  MAX_PAYLOAD_BYTES,
  REALTIME_CHANNEL,
  type RealtimeEvent,
  type RealtimeEventType,
} from './events';

/**
 * Publishes a realtime hint to every connected listener.
 *
 * Uses the pooled connection, because `NOTIFY` is a normal statement — only
 * `LISTEN` requires a dedicated, unpooled session.
 *
 * Publishing is best-effort by design. A realtime notification failing must
 * never fail the write that produced it: the data is already committed, and a
 * client that misses a hint still refreshes on its next poll or page load.
 */
export async function publishEvent(
  familyId: string,
  type: RealtimeEventType,
  options: { actorName?: string } = {},
): Promise<void> {
  const event: RealtimeEvent = {
    familyId,
    type,
    at: Date.now(),
    ...(options.actorName ? { actorName: options.actorName } : {}),
  };

  const payload = JSON.stringify(event);

  if (Buffer.byteLength(payload, 'utf8') > MAX_PAYLOAD_BYTES) {
    // Should be unreachable — hints are tiny — but a silently truncated
    // NOTIFY would be worse than a logged failure.
    console.error('[realtime] payload too large, dropping', { familyId, type });
    return;
  }

  try {
    await db.execute(sql`select pg_notify(${REALTIME_CHANNEL}, ${payload})`);
  } catch (error) {
    console.error('[realtime] publish failed', error instanceof Error ? error.message : error);
  }
}

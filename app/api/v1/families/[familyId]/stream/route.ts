import { getSession } from '@/lib/auth/session';
import { requireMembership } from '@/lib/permissions/family';
import { subscribeToFamily } from '@/lib/realtime/subscribe';
import type { RealtimeEvent } from '@/lib/realtime/events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Server-Sent Events stream for one family.
 *
 * SSE rather than WebSockets: the traffic is entirely server-to-client
 * invalidation hints, EventSource reconnects on its own, and it survives
 * proxies that mishandle upgrade requests.
 *
 * Deployment note. A serverless platform caps how long a function may run, so
 * this stream deliberately closes itself a little before Vercel's limit and
 * lets the browser reconnect, rather than being killed mid-frame. On Vercel
 * this needs Fluid Compute to be worth using at all; without it, the client's
 * polling fallback carries the load. The client handles both, so the feature
 * degrades instead of breaking.
 */

/** Closed before the platform would kill it, so reconnection is graceful. */
const MAX_STREAM_MS = 4 * 60 * 1000;

/** Comment frames keep proxies from closing an idle connection. */
const HEARTBEAT_MS = 25_000;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ familyId: string }> },
) {
  const session = await getSession();

  if (!session) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { familyId } = await params;

  /*
   * Membership is verified before a single byte is streamed, and is not
   * re-checked afterwards — which is part of why the stream is short-lived. A
   * removed member stops receiving hints within one reconnect cycle at worst,
   * and the hints themselves carry no data to leak in the meantime.
   */
  try {
    await requireMembership(session.user.id, familyId);
  } catch {
    return new Response('Not found', { status: 404 });
  }

  const encoder = new TextEncoder();

  /*
   * Teardown is hoisted out of `start` so `cancel` can reach it. Without that,
   * a client navigating away would leave its LISTEN subscriber registered for
   * the life of the process — a slow leak that only shows up under real usage.
   */
  let shutdown: () => void = () => {};

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let unsubscribe: (() => void) | null = null;
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      let lifetime: ReturnType<typeof setTimeout> | null = null;

      shutdown = () => {
        if (closed) return;
        closed = true;

        if (heartbeat) clearInterval(heartbeat);
        if (lifetime) clearTimeout(lifetime);
        unsubscribe?.();

        try {
          controller.close();
        } catch {
          // Already closed by the platform or the client.
        }
      };

      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // Client vanished between checks; treat as closed.
          shutdown();
        }
      };

      // Tell the browser how soon to come back after a disconnect.
      send('retry: 3000\n\n');
      send(': connected\n\n');

      try {
        unsubscribe = await subscribeToFamily(familyId, (event: RealtimeEvent) => {
          send(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
        });
      } catch (error) {
        console.error('[stream] could not subscribe', error);
        // Tell the client to fall back to polling rather than retrying a
        // subscription that is failing for a structural reason.
        send('event: unavailable\ndata: {}\n\n');
        shutdown();
        return;
      }

      heartbeat = setInterval(() => send(': ping\n\n'), HEARTBEAT_MS);

      lifetime = setTimeout(() => {
        // Close before the platform would kill us mid-frame; the browser
        // reconnects on its own.
        send('event: cycle\ndata: {}\n\n');
        shutdown();
      }, MAX_STREAM_MS);
    },

    cancel() {
      // Client navigated away or aborted the request.
      shutdown();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, no-transform',
      Connection: 'keep-alive',
      // Stops nginx buffering the stream into uselessness.
      'X-Accel-Buffering': 'no',
    },
  });
}

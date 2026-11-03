import { afterEach, describe, expect, it, vi } from 'vitest';
import { isRealtimeEvent, type RealtimeEvent } from '@/lib/realtime/events';

/**
 * The realtime backbone.
 *
 * Every live surface rides on it — an incoming call, a new message, a position
 * moving on the map — and none of it had a single test. `subscriberCount` was
 * even exported with the comment "used by tests", by nothing.
 *
 * The LISTEN connection is faked rather than opened: the behaviour worth
 * pinning is the fan-out and what happens when the connection dies, neither of
 * which needs a real Postgres.
 */

/** Captures the handlers the hub installs, so a drop can be simulated. */
const clients: {
  handlers: Map<string, (arg: unknown) => void>;
  connected: boolean;
  ended: boolean;
}[] = [];

vi.mock('pg', () => ({
  Client: class {
    handlers = new Map<string, (arg: unknown) => void>();
    connected = false;
    ended = false;

    constructor() {
      clients.push(this);
    }

    on(event: string, handler: (arg: unknown) => void) {
      this.handlers.set(event, handler);
      return this;
    }

    async connect() {
      this.connected = true;
    }

    async query() {
      return { rows: [] };
    }

    async end() {
      this.ended = true;
    }
  },
}));

vi.mock('@/lib/env', () => ({
  unpooledDatabaseUrl: () => 'postgresql://localhost:5432/test',
}));

const event = (familyId: string, type: RealtimeEvent['type'] = 'message'): RealtimeEvent => ({
  familyId,
  type,
  at: Date.now(),
});

/** Pushes a NOTIFY through the most recently created fake client. */
function emit(payload: unknown) {
  const client = clients.at(-1);
  client?.handlers.get('notification')?.({
    channel: 'famlink_events',
    payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
  });
}

/**
 * A hub with nothing carried over from the last case.
 *
 * `resetModules` alone is not enough: outside production the hub is cached on
 * globalThis, deliberately, so Next's dev-mode module reloading cannot leak a
 * Postgres connection on every edit. That cache outlives a module reset, so a
 * fresh import would find the previous case's client already connected and
 * never create another.
 */
async function freshHub() {
  vi.resetModules();
  clients.length = 0;
  delete (globalThis as { __famlinkHub?: unknown }).__famlinkHub;
  return import('@/lib/realtime/subscribe');
}

afterEach(() => {
  clients.length = 0;
});

/* ========================================================================== */

describe('fan-out', () => {
  it('delivers an event to a subscriber of that family', async () => {
    const { subscribeToFamily } = await freshHub();
    const seen: RealtimeEvent[] = [];

    await subscribeToFamily('fam-1', (e) => seen.push(e));
    emit(event('fam-1'));

    expect(seen).toHaveLength(1);
  });

  /*
   * NOTIFY is a broadcast: every listener in the process sees every family's
   * hints, and this filter is the only thing keeping them apart.
   */
  it('does not deliver another family’s event', async () => {
    const { subscribeToFamily } = await freshHub();
    const seen: RealtimeEvent[] = [];

    await subscribeToFamily('fam-1', (e) => seen.push(e));
    emit(event('fam-2'));

    expect(seen).toHaveLength(0);
  });

  it('delivers to every subscriber of the same family', async () => {
    const { subscribeToFamily } = await freshHub();
    let a = 0;
    let b = 0;

    await subscribeToFamily('fam-1', () => (a += 1));
    await subscribeToFamily('fam-1', () => (b += 1));
    emit(event('fam-1'));

    expect([a, b]).toEqual([1, 1]);
  });

  it('opens one connection however many subscribers there are', async () => {
    const { subscribeToFamily } = await freshHub();

    await subscribeToFamily('fam-1', () => {});
    await subscribeToFamily('fam-2', () => {});
    await subscribeToFamily('fam-3', () => {});

    expect(clients).toHaveLength(1);
  });

  it('keeps delivering after one subscriber throws', async () => {
    const { subscribeToFamily } = await freshHub();
    let reached = false;

    await subscribeToFamily('fam-1', () => {
      throw new Error('bad subscriber');
    });
    await subscribeToFamily('fam-1', () => (reached = true));

    emit(event('fam-1'));
    expect(reached).toBe(true);
  });

  it('ignores a payload that is not an event', async () => {
    const { subscribeToFamily } = await freshHub();
    const seen: RealtimeEvent[] = [];

    await subscribeToFamily('fam-1', (e) => seen.push(e));

    emit('not json at all');
    emit({ nonsense: true });
    emit({ familyId: 'fam-1' });

    expect(seen).toHaveLength(0);
  });
});

describe('unsubscribing', () => {
  it('stops delivery and closes the connection when the last one leaves', async () => {
    const { subscribeToFamily, subscriberCount } = await freshHub();
    const seen: RealtimeEvent[] = [];

    const stop = await subscribeToFamily('fam-1', (e) => seen.push(e));
    expect(subscriberCount()).toBe(1);

    stop();
    expect(subscriberCount()).toBe(0);

    emit(event('fam-1'));
    expect(seen).toHaveLength(0);

    // Idle teardown is scheduled, not awaited by the caller.
    await new Promise((r) => setTimeout(r, 0));
    expect(clients[0]?.ended).toBe(true);
  });

  it('holds the connection open while anyone is still listening', async () => {
    const { subscribeToFamily } = await freshHub();

    const stop = await subscribeToFamily('fam-1', () => {});
    await subscribeToFamily('fam-2', () => {});

    stop();
    await new Promise((r) => setTimeout(r, 0));

    expect(clients[0]?.ended).toBe(false);
  });
});

/* ========================================================================== */

/**
 * The failure this was written for.
 *
 * A dropped LISTEN used to be silent to everybody already connected: the
 * client was nulled so the *next* subscriber would reconnect, but every open
 * stream kept its HTTP connection — healthy, reporting live, receiving
 * nothing. Streams cycle every four minutes, so it recovered on its own, but
 * four minutes of a channel that carries incoming calls is a long time to be
 * quietly dead.
 */
describe('when the LISTEN connection drops', () => {
  it('tells every open stream, so each can reconnect', async () => {
    const { subscribeToFamily } = await freshHub();
    const lost: string[] = [];

    await subscribeToFamily('fam-1', () => {}, () => lost.push('a'));
    await subscribeToFamily('fam-2', () => {}, () => lost.push('b'));

    clients[0]?.handlers.get('error')?.(new Error('connection reset'));

    expect(lost.sort()).toEqual(['a', 'b']);
  });

  it('clears the subscribers it just told', async () => {
    const { subscribeToFamily, subscriberCount } = await freshHub();

    await subscribeToFamily('fam-1', () => {}, () => {});
    expect(subscriberCount()).toBe(1);

    clients[0]?.handlers.get('error')?.(new Error('connection reset'));

    expect(subscriberCount()).toBe(0);
  });

  it('reconnects on the next subscriber rather than reusing a dead socket', async () => {
    const { subscribeToFamily } = await freshHub();

    await subscribeToFamily('fam-1', () => {}, () => {});
    clients[0]?.handlers.get('error')?.(new Error('connection reset'));

    await subscribeToFamily('fam-1', () => {});

    expect(clients).toHaveLength(2);
    expect(clients[1]?.connected).toBe(true);
  });

  it('treats an ended connection the same as an errored one', async () => {
    const { subscribeToFamily } = await freshHub();
    let told = false;

    await subscribeToFamily('fam-1', () => {}, () => (told = true));
    clients[0]?.handlers.get('end')?.(undefined);

    expect(told).toBe(true);
  });

  it('survives a stream whose lost handler throws', async () => {
    const { subscribeToFamily } = await freshHub();
    let second = false;

    await subscribeToFamily('fam-1', () => {}, () => {
      throw new Error('already gone');
    });
    await subscribeToFamily('fam-1', () => {}, () => (second = true));

    clients[0]?.handlers.get('error')?.(new Error('connection reset'));

    expect(second).toBe(true);
  });
});

/* ========================================================================== */

describe('isRealtimeEvent', () => {
  it('accepts a well-formed hint', () => {
    expect(isRealtimeEvent(event('fam-1'))).toBe(true);
  });

  it('refuses anything missing the fields that route it', () => {
    for (const bad of [
      null,
      undefined,
      'string',
      42,
      {},
      { familyId: 'fam-1' },
      { familyId: 'fam-1', type: 'message' },
      { type: 'message', at: Date.now() },
      { familyId: 1, type: 'message', at: Date.now() },
    ]) {
      expect(isRealtimeEvent(bad), `${JSON.stringify(bad)} must be refused`).toBe(false);
    }
  });
});

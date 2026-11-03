import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { ApiError } from '@/lib/api/errors';
import { db } from '@/lib/db';
import { emergencyEvents, notifications } from '@/lib/db/schema';
import {
  acceptInvitation,
  createFamily,
  createInvitation,
} from '@/lib/families/service';
import {
  countUnread,
  listNotifications,
  markRead,
  notifyFamily,
} from '@/lib/notifications/service';
import {
  cancelSos,
  listActiveEmergencies,
  resolveSos,
  triggerSos,
} from '@/lib/notifications/emergency';
import { closeDatabase, createUser, resetDatabase, type TestUser } from './helpers/factories';

async function expectApiError(promise: Promise<unknown>, status: number, code?: string) {
  try {
    await promise;
  } catch (error) {
    expect(error, `expected an ApiError, got ${String(error)}`).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(status);
    if (code) expect((error as ApiError).code).toBe(code);
    return;
  }
  throw new Error(`Expected rejection with ${status}, but the call resolved.`);
}

let owner: TestUser;
let member: TestUser;
let outsider: TestUser;
let familyId: string;

beforeEach(async () => {
  await resetDatabase();
  owner = await createUser('Ama Owner');
  member = await createUser('Kofi Member');
  outsider = await createUser('Stranger Danger');

  const family = await createFamily(owner.id, 'The Boatengs');
  familyId = family.id;

  const invite = await createInvitation(owner.id, familyId, {
    role: 'member',
    expiresInHours: 24,
  });
  await acceptInvitation(member.id, invite.code);
});

afterAll(async () => {
  await closeDatabase();
});

/* ========================================================================== */

describe('notification fan-out', () => {
  it('creates one row per recipient, excluding the actor', async () => {
    await notifyFamily({
      familyId,
      type: 'ARRIVED_PLACE',
      title: 'Kofi arrived',
      message: 'Kofi arrived at School.',
      exclude: member.id,
    });

    // The person who caused the event does not need telling.
    expect(await countUnread(owner.id, familyId)).toBe(1);
    expect(await countUnread(member.id, familyId)).toBe(0);
  });

  it('does not notify members of other families', async () => {
    const other = await createFamily(outsider.id, 'Other Family');

    await notifyFamily({
      familyId,
      type: 'ARRIVED_PLACE',
      title: 'Kofi arrived',
      message: 'Kofi arrived at School.',
    });

    expect(await countUnread(outsider.id, other.id)).toBe(0);
  });

  it('never stores coordinates in the payload', async () => {
    await triggerSos(member.id, {
      familyId,
      latitude: 5.6037,
      longitude: -0.187,
      accuracy: 10,
    });

    const rows = await db
      .select({ data: notifications.data })
      .from(notifications)
      .where(eq(notifications.familyId, familyId));

    // Notifications are not filtered through the location visibility rule, so
    // a position in the payload would bypass it entirely.
    for (const row of rows) {
      const serialised = JSON.stringify(row.data ?? {});
      expect(serialised).not.toContain('5.6037');
      expect(serialised).not.toContain('-0.187');
      expect(row.data).not.toHaveProperty('latitude');
      expect(row.data).not.toHaveProperty('longitude');
    }
  });
});

describe('reading notifications', () => {
  it('refuses a non-member', async () => {
    await expectApiError(listNotifications(outsider.id, familyId), 404);
  });

  it('returns only the caller’s own rows', async () => {
    await notifyFamily({
      familyId,
      type: 'ARRIVED_PLACE',
      title: 'Kofi arrived',
      message: 'Kofi arrived at School.',
      exclude: member.id,
    });

    expect(await listNotifications(owner.id, familyId)).toHaveLength(1);
    expect(await listNotifications(member.id, familyId)).toHaveLength(0);
  });
});

describe('marking read', () => {
  it('cannot mark another member’s notifications read', async () => {
    await notifyFamily({
      familyId,
      type: 'ARRIVED_PLACE',
      title: 'Kofi arrived',
      message: 'Kofi arrived at School.',
      exclude: member.id,
    });

    const [ownerNotification] = await listNotifications(owner.id, familyId);
    expect(ownerNotification).toBeDefined();

    // Member supplies the owner's notification id — the query is scoped by
    // user as well as id, so nothing is updated.
    const marked = await markRead(member.id, familyId, [ownerNotification!.id]);

    expect(marked).toBe(0);
    expect(await countUnread(owner.id, familyId)).toBe(1);
  });

  it('marks everything read when no ids are given', async () => {
    for (let i = 0; i < 3; i += 1) {
      await notifyFamily({
        familyId,
        type: 'ARRIVED_PLACE',
        title: `Event ${i}`,
        message: 'Something happened.',
        exclude: member.id,
      });
    }

    expect(await markRead(owner.id, familyId)).toBe(3);
    expect(await countUnread(owner.id, familyId)).toBe(0);
  });
});

describe('SOS', () => {
  it('refuses a non-member', async () => {
    await expectApiError(triggerSos(outsider.id, { familyId }), 404);
  });

  it('sends without a location when none is available', async () => {
    // The whole point: a device that cannot get a fix must still raise the
    // alarm.
    const event = await triggerSos(member.id, { familyId });

    expect(event.status).toBe('active');
    expect(event.latitude).toBeNull();

    const [notification] = await listNotifications(owner.id, familyId);
    expect(notification?.message).toContain('not available');
  });

  it('notifies the sender too, as delivery confirmation', async () => {
    await triggerSos(member.id, { familyId });

    // Without this the sender has no way to know the alert actually went out.
    expect(await countUnread(member.id, familyId)).toBeGreaterThan(0);
  });

  it('exposes the location of an active alert regardless of sharing settings', async () => {
    // Raising an SOS is a deliberate, specific request for help that overrides
    // the standing sharing preference — but only for this alert.
    await triggerSos(member.id, {
      familyId,
      latitude: 5.6037,
      longitude: -0.187,
      accuracy: 10,
    });

    const active = await listActiveEmergencies(owner.id, familyId);

    expect(active).toHaveLength(1);
    expect(active[0]?.latitude).toBeCloseTo(5.6037, 4);
  });

  it('does not leak emergencies across families', async () => {
    await triggerSos(member.id, { familyId, latitude: 5.6, longitude: -0.18 });

    const other = await createFamily(outsider.id, 'Other Family');
    expect(await listActiveEmergencies(outsider.id, other.id)).toHaveLength(0);
    await expectApiError(listActiveEmergencies(outsider.id, familyId), 404);
  });

  it('lets any member resolve, not only the sender', async () => {
    const event = await triggerSos(member.id, { familyId });

    // Somebody in trouble may be in no position to clear their own alert.
    const resolved = await resolveSos(owner.id, familyId, event.id);

    expect(resolved.status).toBe('resolved');
    expect(await listActiveEmergencies(owner.id, familyId)).toHaveLength(0);
  });

  it('lets only the sender cancel as a false alarm', async () => {
    const event = await triggerSos(member.id, { familyId });

    await expectApiError(cancelSos(owner.id, familyId, event.id), 404);

    await cancelSos(member.id, familyId, event.id);

    const [row] = await db
      .select({ status: emergencyEvents.status })
      .from(emergencyEvents)
      .where(eq(emergencyEvents.id, event.id));

    expect(row?.status).toBe('cancelled');
  });

  it('refuses resolving an alert from another family', async () => {
    const event = await triggerSos(member.id, { familyId });
    const other = await createFamily(outsider.id, 'Other Family');

    await expectApiError(resolveSos(outsider.id, other.id, event.id), 404);

    const [row] = await db
      .select({ status: emergencyEvents.status })
      .from(emergencyEvents)
      .where(
        and(eq(emergencyEvents.id, event.id), eq(emergencyEvents.familyId, familyId)),
      );

    expect(row?.status).toBe('active');
  });

  it('refuses resolving an already-resolved alert', async () => {
    const event = await triggerSos(member.id, { familyId });
    await resolveSos(owner.id, familyId, event.id);

    await expectApiError(resolveSos(member.id, familyId, event.id), 404);
  });
});

/* ========================================================================== */

/**
 * An SOS must survive a bad moment in the database.
 *
 * `displayName` throws if the user row is missing and on any transient error,
 * and it sits between recording the emergency and telling anybody about it.
 * Unguarded, a hiccup on that one query left the alert stored as active with
 * nobody notified, no realtime hint, and a 500 returned to somebody who had
 * just pressed SOS and now had no way to know whether help was coming.
 *
 * Eleven other callers across calls, check-ins and location already guarded
 * it. This path was the exception, in the one place the consequence is worst.
 */
describe('SOS when the name cannot be looked up', () => {
  /** Fails only the name lookup; the insert before it still succeeds. */
  function breakNameLookup() {
    const original = db.select.bind(db);
    let calls = 0;

    return vi.spyOn(db, 'select').mockImplementation(((...args: unknown[]) => {
      calls += 1;
      /*
       * The second select, not the first. `requireMembership` queries first in
       * all three of these functions; the name lookup is the one after it.
       */
      if (calls === 2) throw new Error('connection terminated unexpectedly');
      return (original as (...a: unknown[]) => unknown)(...args);
    }) as typeof db.select);
  }

  it('still raises the alarm, and still tells the family', async () => {
    const spy = breakNameLookup();

    try {
      const event = await triggerSos(member.id, { familyId, latitude: 5.6, longitude: -0.18 });
      expect(event.status).toBe('active');
    } finally {
      spy.mockRestore();
    }

    // The family heard about it, which is the entire point of the feature.
    const forOwner = await listNotifications(owner.id, familyId);
    expect(forOwner.some((n) => n.type === 'SOS')).toBe(true);

    // And it is still on record as live.
    const active = await listActiveEmergencies(owner.id, familyId);
    expect(active).toHaveLength(1);
  });

  it('names them generically rather than failing', async () => {
    const spy = breakNameLookup();

    try {
      await triggerSos(member.id, { familyId });
    } finally {
      spy.mockRestore();
    }

    const [alert] = await listNotifications(owner.id, familyId);
    expect(alert?.message.length).toBeGreaterThan(0);
    // A placeholder is acceptable; a missing alert is not.
    expect(alert?.title).toContain('needs help');
  });

  it('still tells the family when an emergency is resolved', async () => {
    const event = await triggerSos(member.id, { familyId });
    await markRead(owner.id, familyId);

    const spy = breakNameLookup();
    try {
      await resolveSos(owner.id, familyId, event.id);
    } finally {
      spy.mockRestore();
    }

    const notes = await listNotifications(member.id, familyId);
    expect(notes.some((n) => n.title === 'Emergency resolved')).toBe(true);
  });

  it('still tells the family when an alert was a false alarm', async () => {
    const event = await triggerSos(member.id, { familyId });

    const spy = breakNameLookup();
    try {
      await cancelSos(member.id, familyId, event.id);
    } finally {
      spy.mockRestore();
    }

    const notes = await listNotifications(owner.id, familyId);
    expect(notes.some((n) => n.title === 'False alarm')).toBe(true);
  });
});

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { countUnreadMessagesByFamily, markThreadRead, sendMessage } from '@/lib/chat/service';
import {
  countUnreadByFamily,
  markRead,
  notifyFamily,
} from '@/lib/notifications/service';
import { resolveShellData } from '@/lib/families/shell';
import {
  acceptInvitation,
  createFamily,
  createInvitation,
} from '@/lib/families/service';
import { closeDatabase, createUser, resetDatabase, type TestUser } from './helpers/factories';

/*
 * `resolveShellData` reads the current-family cookie, so it needs a request
 * scope it cannot have here. Same in-memory jar as tests/current-family.test.ts
 * — enough to prove the server-side resolution, which is what is under test.
 */
const { jar } = vi.hoisted(() => ({ jar: new Map<string, string>() }));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.has(name) ? { name, value: jar.get(name) as string } : undefined,
    set: (name: string, value: string) => {
      jar.set(name, value);
    },
    delete: (name: string) => {
      jar.delete(name);
    },
  }),
}));

/**
 * Unread counts for the families you are *not* looking at.
 *
 * The gap these close: the family switcher listed names, member counts and
 * roles and nothing else, so anything waiting in another family — an unread
 * chat, an arrival, an SOS — was invisible until you happened to switch into
 * it. Two functions that could have answered it existed and returned a single
 * grand total, which cannot say *which* family is waiting, and nothing called
 * either of them.
 *
 * The sharp case is the emergency: a family safety app that hides an SOS
 * behind a dropdown has hidden it in the worst possible place.
 */

let owner: TestUser;
let member: TestUser;
let outsider: TestUser;
let homeId: string;
let otherId: string;

/** Adds `who` to `familyId` as a plain member. */
async function join(familyId: string, who: TestUser) {
  const invite = await createInvitation(owner.id, familyId, {
    role: 'member',
    expiresInHours: 24,
  });
  await acceptInvitation(who.id, invite.code);
}

beforeEach(async () => {
  jar.clear();
  await resetDatabase();
  owner = await createUser('Ama Owner');
  member = await createUser('Kofi Member');
  outsider = await createUser('Stranger Danger');

  homeId = (await createFamily(owner.id, 'The Boatengs')).id;
  otherId = (await createFamily(owner.id, 'The Grandparents')).id;

  await join(homeId, member);
  await join(otherId, member);
});

afterAll(async () => {
  await closeDatabase();
});

/* ========================================================================== */

describe('unread messages per family', () => {
  it('attributes each message to the family it was sent in', async () => {
    await sendMessage(owner.id, homeId, 'one');
    await sendMessage(owner.id, homeId, 'two');
    await sendMessage(owner.id, otherId, 'three');

    const counts = await countUnreadMessagesByFamily(member.id);

    expect(counts.get(homeId)).toBe(2);
    expect(counts.get(otherId)).toBe(1);
  });

  it('leaves a family with nothing unread out entirely', async () => {
    await sendMessage(owner.id, homeId, 'one');

    const counts = await countUnreadMessagesByFamily(member.id);

    // Absent rather than zero, so a caller never walks a map of noughts.
    expect(counts.has(otherId)).toBe(false);
  });

  it('does not count your own messages against you', async () => {
    await sendMessage(member.id, homeId, 'mine');

    expect((await countUnreadMessagesByFamily(member.id)).get(homeId)).toBeUndefined();
  });

  it('clears only the family that was read', async () => {
    await sendMessage(owner.id, homeId, 'one');
    await sendMessage(owner.id, otherId, 'two');

    await markThreadRead(member.id, homeId);
    const counts = await countUnreadMessagesByFamily(member.id);

    expect(counts.get(homeId)).toBeUndefined();
    expect(counts.get(otherId)).toBe(1);
  });

  it('counts nothing for somebody in neither family', async () => {
    await sendMessage(owner.id, homeId, 'one');

    expect((await countUnreadMessagesByFamily(outsider.id)).size).toBe(0);
  });
});

describe('unread alerts per family', () => {
  it('attributes each alert to its family', async () => {
    await notifyFamily({
      familyId: otherId,
      type: 'ARRIVED_PLACE',
      title: 'Ama arrived',
      message: 'Ama arrived at Home.',
      exclude: owner.id,
    });

    const counts = await countUnreadByFamily(member.id);

    expect(counts.get(otherId)).toBe(1);
    expect(counts.has(homeId)).toBe(false);
  });

  it('surfaces an SOS raised in the family you are not looking at', async () => {
    /*
     * The case that matters. Somebody looking at The Boatengs used to have no
     * indication at all that an emergency had been raised in The Grandparents.
     */
    await notifyFamily({
      familyId: otherId,
      type: 'SOS',
      title: '🚨 Ama needs help',
      message: 'Ama triggered an SOS.',
      exclude: owner.id,
    });

    expect((await countUnreadByFamily(member.id)).get(otherId)).toBe(1);
  });

  it('stops counting once they are read', async () => {
    await notifyFamily({
      familyId: otherId,
      type: 'ARRIVED_PLACE',
      title: 'Ama arrived',
      message: 'Ama arrived at Home.',
      exclude: owner.id,
    });

    await markRead(member.id, otherId);

    expect((await countUnreadByFamily(member.id)).has(otherId)).toBe(false);
  });
});

describe('the app chrome', () => {
  it('carries the counts for every family, not only the current one', async () => {
    await sendMessage(owner.id, otherId, 'over here');
    await notifyFamily({
      familyId: otherId,
      type: 'SOS',
      title: '🚨 Ama needs help',
      message: 'Ama triggered an SOS.',
      exclude: owner.id,
    });

    const shell = await resolveShellData(member.id);
    const other = shell.families.find((f) => f.id === otherId);

    expect(other?.unreadMessages).toBe(1);
    // Two: the SOS, plus the notification the chat message itself raised.
    expect(other?.unreadAlerts).toBe(2);
  });

  it('reports zero rather than undefined for a quiet family', async () => {
    const shell = await resolveShellData(member.id);

    // The switcher reads these directly, so they must be numbers everywhere.
    for (const family of shell.families) {
      expect(typeof family.unreadAlerts).toBe('number');
      expect(typeof family.unreadMessages).toBe('number');
    }
  });

  it('still reports the current family the way it always did', async () => {
    await sendMessage(owner.id, homeId, 'one');

    const shell = await resolveShellData(member.id);

    // Whichever family is current, its own badge numbers come from the
    // single-family counters and must agree with the per-family map.
    const current = shell.families.find((f) => f.id === shell.family?.id);
    expect(shell.unreadMessages).toBe(current?.unreadMessages);
    expect(shell.alertCount).toBe(current?.unreadAlerts);
  });
});

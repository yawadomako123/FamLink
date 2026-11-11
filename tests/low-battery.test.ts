import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  acceptInvitation,
  createFamily,
  createInvitation,
} from '@/lib/families/service';
import { recordLocation, updateSharingSettings } from '@/lib/location/service';
import { listNotifications } from '@/lib/notifications/service';
import { closeDatabase, createUser, resetDatabase, type TestUser } from './helpers/factories';

/**
 * Telling the family a phone is about to die.
 *
 * A dying phone is the most common reason somebody goes quiet, so this is the
 * warning that explains a map which is about to stop updating.
 *
 * It is alerted at most once per run-down, and the interesting part is what
 * counts as the run-down being over. Percentage alone was not enough:
 * re-arming needed a reading at 30% or more, and readings only happen while
 * the app is open, because a PWA cannot watch the battery in the background.
 * A phone charged overnight with FamLink closed was therefore never seen above
 * the threshold, so the mark stayed set and every later run-down was silent.
 */

let owner: TestUser;
let member: TestUser;
let familyId: string;

/** One position carrying a battery reading. */
async function reportBattery(percentage: number, isCharging: boolean, nth: number) {
  await recordLocation(member.id, {
    familyId,
    // Moved each time so nothing is discarded as a duplicate position.
    latitude: 5.6037 + nth * 0.02,
    longitude: -0.187,
    accuracy: 10,
    recordedAt: new Date(Date.now() + nth * 60_000),
    battery: { percentage, isCharging },
  });
}

async function lowBatteryAlerts(): Promise<number> {
  const notes = await listNotifications(owner.id, familyId);
  return notes.filter((n) => (n.data as { lowBattery?: boolean } | null)?.lowBattery).length;
}

beforeEach(async () => {
  await resetDatabase();
  owner = await createUser('Ama Owner');
  member = await createUser('Kofi Member');
  familyId = (await createFamily(owner.id, 'The Boatengs')).id;

  const invite = await createInvitation(owner.id, familyId, {
    role: 'member',
    expiresInHours: 24,
  });
  await acceptInvitation(member.id, invite.code);
  await updateSharingSettings(member.id, familyId, { state: 'sharing' });
});

afterAll(async () => {
  await closeDatabase();
});

/* ========================================================================== */

describe('the first time a phone runs down', () => {
  it('tells the family', async () => {
    await reportBattery(10, false, 0);

    expect(await lowBatteryAlerts()).toBe(1);
  });

  it('says nothing while there is plenty left', async () => {
    await reportBattery(80, false, 0);

    expect(await lowBatteryAlerts()).toBe(0);
  });

  it('does not repeat itself as the phone keeps draining', async () => {
    await reportBattery(14, false, 0);
    await reportBattery(11, false, 1);
    await reportBattery(4, false, 2);

    // One run-down, one warning — not a countdown.
    expect(await lowBatteryAlerts()).toBe(1);
  });
});

describe('after the phone has been charged', () => {
  it('warns again once it has been back above the threshold', async () => {
    await reportBattery(10, false, 0);
    await reportBattery(80, false, 1);
    await reportBattery(9, false, 2);

    expect(await lowBatteryAlerts()).toBe(2);
  });

  it('warns again when all the app saw was the phone plugged in', async () => {
    /*
     * The case that was silent. The phone charged while FamLink was closed, so
     * no reading at 30% or more ever arrived — but the app did see it
     * charging, which says the run-down is over just as plainly.
     */
    await reportBattery(10, false, 0);
    await reportBattery(12, true, 1);
    await reportBattery(9, false, 2);

    expect(await lowBatteryAlerts()).toBe(2);
  });

  it('does not warn about a phone that is plugged in', async () => {
    // "Their location may stop updating soon" is the wrong thing to say about
    // a battery on its way up.
    await reportBattery(8, true, 0);

    expect(await lowBatteryAlerts()).toBe(0);
  });

  it('warns once it is unplugged and still low', async () => {
    await reportBattery(8, true, 0);
    await reportBattery(8, false, 1);

    expect(await lowBatteryAlerts()).toBe(1);
  });
});

describe('a device that does not report whether it is charging', () => {
  it('is not treated as charging', async () => {
    /*
     * Unknown must not re-arm on a guess, or a device that never reports the
     * flag would warn on every single reading below the threshold.
     */
    await recordLocation(member.id, {
      familyId,
      latitude: 5.6037,
      longitude: -0.187,
      accuracy: 10,
      recordedAt: new Date(),
      battery: { percentage: 10 },
    });
    await recordLocation(member.id, {
      familyId,
      latitude: 5.64,
      longitude: -0.187,
      accuracy: 10,
      recordedAt: new Date(Date.now() + 60_000),
      battery: { percentage: 9 },
    });

    expect(await lowBatteryAlerts()).toBe(1);
  });
});

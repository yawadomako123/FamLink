import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { currentLocations, familyMembers } from '@/lib/db/schema';
import { hasSharingLapsed, withSharingExpiry } from '@/lib/location/expiry';
import {
  acceptInvitation,
  createFamily,
  createInvitation,
  leaveFamily,
  removeMember,
} from '@/lib/families/service';
import { listFamilyMembers } from '@/lib/families/queries';
import { getMembership } from '@/lib/permissions/family';
import {
  getFamilyLocations,
  recordLocation,
  updateSharingSettings,
} from '@/lib/location/service';
import { closeDatabase, createUser, resetDatabase, type TestUser } from './helpers/factories';

/**
 * Timed sharing, after the window has run out.
 *
 * Nothing updates the row when a window ends — and somebody whose hour is up
 * has usually stopped sending positions, which is the only thing that would.
 * So `location_sharing_state` stays `sharing` beside a `sharing_expires_at`
 * in the past, and every reader that trusts the column is wrong from then on.
 *
 * `getFamilyLocations` corrected for it, so the map was right. The dashboard,
 * the family member list and the member's own sharing switch did not, so most
 * of the app went on saying somebody was sharing after they had stopped — and
 * the switch, which initialises from this column, sat in the "on" position
 * for the person it belonged to.
 */

let owner: TestUser;
let member: TestUser;
let familyId: string;

/** Drags the window's end into the past, as if the hour had run out. */
async function lapseWindow(userId: string) {
  await db
    .update(familyMembers)
    .set({ sharingExpiresAt: new Date(Date.now() - 60_000) })
    .where(and(eq(familyMembers.familyId, familyId), eq(familyMembers.userId, userId)));
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
});

afterAll(async () => {
  await closeDatabase();
});

/* ========================================================================== */

describe('the rule itself', () => {
  const sharing = { locationSharingState: 'sharing' as const, sharingExpiresAt: null };

  it('leaves indefinite sharing alone', () => {
    expect(hasSharingLapsed(sharing)).toBe(false);
    expect(withSharingExpiry(sharing)).toBe(sharing);
  });

  it('leaves a window that is still running alone', () => {
    const row = { ...sharing, sharingExpiresAt: new Date(Date.now() + 60_000) };

    expect(hasSharingLapsed(row)).toBe(false);
    // Same object back, so mapping a list does not churn references.
    expect(withSharingExpiry(row)).toBe(row);
  });

  it('reports a lapsed window as off', () => {
    const row = { ...sharing, sharingExpiresAt: new Date(Date.now() - 1) };

    expect(hasSharingLapsed(row)).toBe(true);
    expect(withSharingExpiry(row).locationSharingState).toBe('off');
  });

  it('says off rather than paused', () => {
    // Paused is a choice the member made and can undo from the switch. A
    // window running out is not that, and must not look like it.
    const row = { ...sharing, sharingExpiresAt: new Date(Date.now() - 1) };

    expect(withSharingExpiry(row).locationSharingState).not.toBe('paused');
  });

  it('treats the exact expiry moment as over', () => {
    const at = Date.now();
    const row = { ...sharing, sharingExpiresAt: new Date(at) };

    expect(hasSharingLapsed(row, at)).toBe(true);
  });

  it('keeps every other field', () => {
    const row = {
      ...sharing,
      sharingExpiresAt: new Date(Date.now() - 1),
      name: 'Ama Owner',
      batteryPercentage: 42,
    };

    const applied = withSharingExpiry(row);
    expect(applied.name).toBe('Ama Owner');
    expect(applied.batteryPercentage).toBe(42);
  });
});

describe('every screen agrees', () => {
  beforeEach(async () => {
    await updateSharingSettings(owner.id, familyId, {
      state: 'sharing',
      durationMinutes: 60,
    });
    await recordLocation(owner.id, {
      familyId,
      latitude: 5.6037,
      longitude: -0.187,
      accuracy: 12,
      recordedAt: new Date(),
    });
    await lapseWindow(owner.id);
  });

  it('keeps the position off the map', async () => {
    // This one was always right, and is what made the disagreement visible.
    const { locations } = await getFamilyLocations(member.id, familyId);

    expect(locations.some((l) => l.userId === owner.id)).toBe(false);
  });

  it('no longer tells the family member list they are sharing', async () => {
    const members = await listFamilyMembers(member.id, familyId);
    const ama = members.find((m) => m.userId === owner.id);

    expect(ama?.locationSharingState).toBe('off');
  });

  it('tells the member themselves that sharing has ended', async () => {
    /*
     * The sharing switch initialises from this, so before the fix it sat in
     * the "on" position after sharing had stopped — the one place the lie
     * matters most, because it is the member's own account of what they are
     * sharing with their family.
     */
    const raw = await getMembership(owner.id, familyId);
    expect(raw?.locationSharingState, 'the stored row is expected to be stale').toBe('sharing');

    const applied = raw ? withSharingExpiry(raw) : null;
    expect(applied?.locationSharingState).toBe('off');
  });

  it('reports them as not-sharing rather than hidden', async () => {
    const { withheld } = await getFamilyLocations(member.id, familyId);

    // "Hidden" would suggest they chose to conceal it from this viewer.
    expect(withheld.find((w) => w.userId === owner.id)?.reason).toBe('not-sharing');
  });
});

describe('a window that is still running', () => {
  beforeEach(async () => {
    await updateSharingSettings(owner.id, familyId, {
      state: 'sharing',
      durationMinutes: 60,
    });
    await recordLocation(owner.id, {
      familyId,
      latitude: 5.6037,
      longitude: -0.187,
      accuracy: 12,
      recordedAt: new Date(),
    });
  });

  it('still shows on the map', async () => {
    const { locations } = await getFamilyLocations(member.id, familyId);

    expect(locations.some((l) => l.userId === owner.id)).toBe(true);
  });

  it('still reads as sharing in the member list', async () => {
    const members = await listFamilyMembers(member.id, familyId);

    expect(
      members.find((m) => m.userId === owner.id)?.locationSharingState,
    ).toBe('sharing');
  });

  it('carries the window end, so a countdown can be shown', async () => {
    const members = await listFamilyMembers(member.id, familyId);

    expect(members.find((m) => m.userId === owner.id)?.sharingExpiresAt).toBeInstanceOf(Date);
  });
});

describe('a position outliving the membership it belonged to', () => {
  /*
   * `current_locations` is keyed by user and family, not by membership, so a
   * membership ending left the row behind. Nobody could read it — every
   * location read joins through `family_members` — but rejoining made it
   * readable again, and switching sharing on republished a position from a
   * stint in the family that had already ended, before the device had sent
   * anything new.
   */
  it('is gone when the member leaves', async () => {
    await updateSharingSettings(member.id, familyId, { state: 'sharing' });
    await recordLocation(member.id, {
      familyId,
      latitude: 5.6037,
      longitude: -0.187,
      accuracy: 12,
      recordedAt: new Date(),
    });

    await leaveFamily(member.id, familyId);

    const [left] = await db
      .select({ userId: currentLocations.userId })
      .from(currentLocations)
      .where(
        and(
          eq(currentLocations.familyId, familyId),
          eq(currentLocations.userId, member.id),
        ),
      );

    expect(left).toBeUndefined();
  });

  it('is gone when an admin removes them', async () => {
    await updateSharingSettings(member.id, familyId, { state: 'sharing' });
    await recordLocation(member.id, {
      familyId,
      latitude: 5.6037,
      longitude: -0.187,
      accuracy: 12,
      recordedAt: new Date(),
    });

    await removeMember(owner.id, familyId, member.id);

    const [left] = await db
      .select({ userId: currentLocations.userId })
      .from(currentLocations)
      .where(
        and(
          eq(currentLocations.familyId, familyId),
          eq(currentLocations.userId, member.id),
        ),
      );

    expect(left).toBeUndefined();
  });

  it('does not republish an old position when they rejoin', async () => {
    await updateSharingSettings(member.id, familyId, { state: 'sharing' });
    await recordLocation(member.id, {
      familyId,
      latitude: 5.6037,
      longitude: -0.187,
      accuracy: 12,
      // A stint that ended long ago.
      recordedAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
    });

    await leaveFamily(member.id, familyId);

    const rejoin = await createInvitation(owner.id, familyId, {
      role: 'member',
      expiresInHours: 24,
    });
    await acceptInvitation(member.id, rejoin.code);

    // They switch sharing back on, but their device has sent nothing yet.
    await updateSharingSettings(member.id, familyId, { state: 'sharing' });
    const { locations: shown, withheld } = await getFamilyLocations(owner.id, familyId);

    expect(shown.some((l) => l.userId === member.id)).toBe(false);
    expect(withheld.find((w) => w.userId === member.id)?.reason).toBe('no-fix');
  });

  it('leaves another family’s position alone', async () => {
    const other = (await createFamily(member.id, 'Kofi’s Own')).id;
    await updateSharingSettings(member.id, other, { state: 'sharing' });
    await recordLocation(member.id, {
      familyId: other,
      latitude: 5.6037,
      longitude: -0.187,
      accuracy: 12,
      recordedAt: new Date(),
    });

    await leaveFamily(member.id, familyId);

    const [kept] = await db
      .select({ userId: currentLocations.userId })
      .from(currentLocations)
      .where(
        and(eq(currentLocations.familyId, other), eq(currentLocations.userId, member.id)),
      );

    expect(kept).toBeDefined();
  });
});

describe('sharing with no window at all', () => {
  it('is never treated as lapsed', async () => {
    await updateSharingSettings(owner.id, familyId, { state: 'sharing' });
    await recordLocation(owner.id, {
      familyId,
      latitude: 5.6037,
      longitude: -0.187,
      accuracy: 12,
      recordedAt: new Date(),
    });

    const members = await listFamilyMembers(member.id, familyId);
    const { locations } = await getFamilyLocations(member.id, familyId);

    expect(members.find((m) => m.userId === owner.id)?.locationSharingState).toBe('sharing');
    expect(locations.some((l) => l.userId === owner.id)).toBe(true);
  });
});

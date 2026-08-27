import { describe, expect, it } from 'vitest';
import { canViewLocation, roleAtLeast } from '@/lib/permissions/location-visibility';
import type { FamilyMember } from '@/lib/db/schema';

/**
 * The single most important rule in FamLink: who may see whose location.
 *
 * These tests are written as a deny-by-default checklist. Every case that
 * should be refused is asserted explicitly, because the failure mode here is
 * silent disclosure rather than a crash.
 */

const FAMILY = '11111111-1111-1111-1111-111111111111';
const OTHER_FAMILY = '22222222-2222-2222-2222-222222222222';

type Target = Parameters<typeof canViewLocation>[1];

function viewer(userId: string, familyId = FAMILY) {
  return { userId, familyId } satisfies Pick<FamilyMember, 'userId' | 'familyId'>;
}

function target(
  userId: string,
  sharing: FamilyMember['locationSharingState'],
  visibility: FamilyMember['locationVisibility'],
  familyId = FAMILY,
): Target {
  return {
    userId,
    familyId,
    locationSharingState: sharing,
    locationVisibility: visibility,
  };
}

describe('canViewLocation', () => {
  describe('when sharing is on and visible to everyone', () => {
    it('allows another member of the same family', () => {
      expect(canViewLocation(viewer('dad'), target('sarah', 'sharing', 'everyone'))).toBe(true);
    });
  });

  describe('sharing state', () => {
    it('refuses when the target has sharing switched off', () => {
      expect(canViewLocation(viewer('dad'), target('sarah', 'off', 'everyone'))).toBe(false);
    });

    it('refuses when the target has paused sharing', () => {
      // Paused must behave exactly like off for viewers — that is the promise
      // the pause control makes to the person who tapped it.
      expect(canViewLocation(viewer('dad'), target('sarah', 'paused', 'everyone'))).toBe(false);
    });
  });

  describe('visibility', () => {
    it('refuses when visibility is nobody, even while actively sharing', () => {
      expect(canViewLocation(viewer('dad'), target('sarah', 'sharing', 'nobody'))).toBe(false);
    });

    it('refuses "selected" visibility when no allow-list is supplied', () => {
      // The MVP never writes this mode, so reaching it must fail closed.
      expect(canViewLocation(viewer('dad'), target('sarah', 'sharing', 'selected'))).toBe(false);
    });

    it('refuses "selected" visibility when the viewer is not on the allow-list', () => {
      expect(
        canViewLocation(viewer('dad'), target('sarah', 'sharing', 'selected'), new Set(['mum'])),
      ).toBe(false);
    });

    it('allows "selected" visibility when the viewer is on the allow-list', () => {
      expect(
        canViewLocation(viewer('dad'), target('sarah', 'sharing', 'selected'), new Set(['dad'])),
      ).toBe(true);
    });
  });

  describe('family boundary', () => {
    it('refuses a viewer from a different family', () => {
      expect(
        canViewLocation(
          viewer('stranger', OTHER_FAMILY),
          target('sarah', 'sharing', 'everyone', FAMILY),
        ),
      ).toBe(false);
    });

    it('compares family ids rather than assuming a single family', () => {
      // Both parties in the *other* family must still be allowed, proving the
      // check is an equality test and not a hardcoded id.
      expect(
        canViewLocation(
          viewer('dad', OTHER_FAMILY),
          target('sarah', 'sharing', 'everyone', OTHER_FAMILY),
        ),
      ).toBe(true);
    });
  });

  describe('self access', () => {
    it('always lets a member see their own location', () => {
      expect(canViewLocation(viewer('sarah'), target('sarah', 'off', 'nobody'))).toBe(true);
    });

    it('does not let self-access leak across families', () => {
      expect(
        canViewLocation(viewer('sarah', OTHER_FAMILY), target('sarah', 'sharing', 'everyone')),
      ).toBe(false);
    });
  });
});

describe('roleAtLeast', () => {
  it('ranks owner above admin above member', () => {
    expect(roleAtLeast('owner', 'admin')).toBe(true);
    expect(roleAtLeast('admin', 'member')).toBe(true);
    expect(roleAtLeast('member', 'admin')).toBe(false);
    expect(roleAtLeast('admin', 'owner')).toBe(false);
  });

  it('treats a role as satisfying itself', () => {
    expect(roleAtLeast('member', 'member')).toBe(true);
    expect(roleAtLeast('owner', 'owner')).toBe(true);
  });
});

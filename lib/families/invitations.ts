import 'server-only';

import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * Invitation codes.
 *
 * A code is the only credential needed to join a family, so it is treated like
 * one: generated from a CSPRNG, stored hashed, and compared in constant time.
 *
 * The alphabet omits characters that people confuse when reading a code aloud
 * or copying it by hand — I/1, O/0, and lowercase entirely. That leaves 32
 * symbols; at 8 characters a code carries 40 bits of entropy, which combined
 * with expiry, single use and rate limiting is well beyond guessable.
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

export function generateInvitationCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    // randomInt is CSPRNG-backed and rejection-samples, so no modulo bias.
    code += ALPHABET[randomInt(ALPHABET.length)];
  }
  return code;
}

/**
 * Codes are stored hashed so a database leak does not yield working
 * invitations. SHA-256 without a salt is deliberate here: lookups are by hash,
 * which requires determinism, and a 40-bit CSPRNG code is not a low-entropy
 * secret that salting would protect.
 */
export function hashInvitationCode(code: string): string {
  return createHash('sha256').update(code.trim().toUpperCase(), 'utf8').digest('hex');
}

/** Constant-time comparison, so timing cannot be used to narrow a code. */
export function invitationCodeMatches(code: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashInvitationCode(code), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');

  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function invitationUrl(code: string, appUrl: string): string {
  return `${appUrl.replace(/\/$/, '')}/join/${code}`;
}

/* -------------------------------------------------------------------------- */
/* Status                                                                      */
/* -------------------------------------------------------------------------- */

export type InvitationStatus = 'valid' | 'expired' | 'used' | 'revoked';

export interface InvitationLifecycle {
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
}

/**
 * Order matters: revoked beats used beats expired. An admin who revoked a link
 * should be told it was revoked, not that it happens to have also expired.
 */
export function invitationStatus(
  invitation: InvitationLifecycle,
  now: Date = new Date(),
): InvitationStatus {
  if (invitation.revokedAt) return 'revoked';
  if (invitation.usedAt) return 'used';
  if (invitation.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'valid';
}

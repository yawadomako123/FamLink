import { z } from 'zod';

/** Shared by the family forms and the API routes that back them. */

export const familyNameSchema = z
  .string()
  .trim()
  .min(2, 'Give your family a name of at least 2 characters.')
  .max(60, 'That name is too long.');

export const createFamilySchema = z.object({
  name: familyNameSchema,
});

export const renameFamilySchema = z.object({
  name: familyNameSchema,
});

/**
 * Only `admin` and `member` are assignable. Ownership transfers through its own
 * endpoint, because it is a single-holder role with different consequences.
 */
export const assignableRoleSchema = z.enum(['admin', 'member']);

export const updateMemberRoleSchema = z.object({
  role: assignableRoleSchema,
});

export const createInvitationSchema = z.object({
  role: assignableRoleSchema.default('member'),
  /** How long the link stays valid. Capped at a week. */
  expiresInHours: z.number().int().min(1).max(24 * 7).default(24 * 7),
});

/**
 * Invitation codes are uppercase and drawn from an unambiguous alphabet, so
 * they survive being read aloud or copied by hand.
 */
export const invitationCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/, 'That does not look like a valid invite code.');

export type CreateFamilyInput = z.infer<typeof createFamilySchema>;
export type AssignableRole = z.infer<typeof assignableRoleSchema>;

import { z } from 'zod';

/**
 * Location input validation.
 *
 * Coordinates arrive from a device we do not control, so every field is range
 * checked rather than merely type checked. A malformed fix must be rejected at
 * the boundary, not stored and then rendered as a family member standing in
 * the Gulf of Guinea.
 */

export const latitudeSchema = z
  .number()
  .min(-90, 'Latitude out of range.')
  .max(90, 'Latitude out of range.')
  .refine(Number.isFinite, 'Latitude must be a finite number.');

export const longitudeSchema = z
  .number()
  .min(-180, 'Longitude out of range.')
  .max(180, 'Longitude out of range.')
  .refine(Number.isFinite, 'Longitude must be a finite number.');

/**
 * Reported accuracy radius in metres. Rejected above 100km: a fix that vague
 * is not a location, and storing it would let the map imply knowledge we do
 * not have.
 */
export const accuracySchema = z
  .number()
  .min(0)
  .max(100_000)
  .refine(Number.isFinite, 'Accuracy must be a finite number.')
  .optional();

/**
 * When the device took the reading. Clients may batch a few fixes while
 * briefly offline, so the past is allowed — but the future is not, beyond a
 * small allowance for clock skew.
 */
const MAX_CLOCK_SKEW_MS = 2 * 60 * 1000;
const MAX_BACKDATE_MS = 24 * 60 * 60 * 1000;

export const recordedAtSchema = z
  .union([z.string(), z.number(), z.date()])
  .transform((value, ctx) => {
    const date = value instanceof Date ? value : new Date(value);

    if (Number.isNaN(date.getTime())) {
      ctx.addIssue({ code: 'custom', message: 'Invalid timestamp.' });
      return z.NEVER;
    }

    const now = Date.now();

    if (date.getTime() > now + MAX_CLOCK_SKEW_MS) {
      ctx.addIssue({ code: 'custom', message: 'Timestamp is in the future.' });
      return z.NEVER;
    }

    if (date.getTime() < now - MAX_BACKDATE_MS) {
      ctx.addIssue({ code: 'custom', message: 'Timestamp is too old to accept.' });
      return z.NEVER;
    }

    return date;
  });

/** Optional device telemetry. A native client supplies it; browsers may not. */
export const batterySchema = z
  .object({
    percentage: z.number().int().min(0).max(100),
    isCharging: z.boolean().optional(),
  })
  .optional();

export const locationUpdateSchema = z.object({
  familyId: z.uuid(),
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  accuracy: accuracySchema,
  recordedAt: recordedAtSchema,
  battery: batterySchema,
});

export type LocationUpdateInput = z.infer<typeof locationUpdateSchema>;

/* -------------------------------------------------------------------------- */
/* Sharing settings                                                            */
/* -------------------------------------------------------------------------- */

export const sharingStateSchema = z.enum(['off', 'sharing', 'paused']);

/** The MVP writes only `everyone` or `nobody`; `selected` ships later. */
export const visibilitySchema = z.enum(['everyone', 'nobody']);

export const updateSharingSchema = z
  .object({
    state: sharingStateSchema.optional(),
    visibility: visibilitySchema.optional(),
  })
  .refine((v) => v.state !== undefined || v.visibility !== undefined, {
    message: 'Provide a sharing state, a visibility setting, or both.',
  });

export const historyQuerySchema = z.object({
  familyId: z.uuid(),
  /** ISO date (YYYY-MM-DD) in the viewer's timezone. */
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date as YYYY-MM-DD.')
    .optional(),
  /** Minutes offset from UTC, so days are bucketed in the viewer's timezone. */
  timezoneOffset: z.coerce.number().int().min(-840).max(840).default(0),
});

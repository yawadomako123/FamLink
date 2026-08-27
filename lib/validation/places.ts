import { z } from 'zod';
import { latitudeSchema, longitudeSchema } from './location';

/**
 * Place validation.
 *
 * The radius bounds are chosen from what geofencing can actually deliver.
 * Consumer GPS is commonly accurate to 10–50m in the open and much worse
 * indoors, so a radius below 50m would produce arrival and departure events
 * from noise alone. The upper bound keeps a "place" recognisable as a place
 * rather than a district.
 */
export const MIN_RADIUS_M = 50;
export const MAX_RADIUS_M = 5_000;
export const DEFAULT_RADIUS_M = 200;

export const placeIcons = [
  'home',
  'school',
  'work',
  'university',
  'shop',
  'gym',
  'hospital',
  'pin',
] as const;

export type PlaceIcon = (typeof placeIcons)[number];

export const placeNameSchema = z
  .string()
  .trim()
  .min(1, 'Give this place a name.')
  .max(60, 'That name is too long.');

export const createPlaceSchema = z.object({
  name: placeNameSchema,
  address: z.string().trim().max(120).optional(),
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  radius: z
    .number()
    .int('Radius must be a whole number of metres.')
    .min(MIN_RADIUS_M, `Use a radius of at least ${MIN_RADIUS_M}m — GPS is not precise enough below that.`)
    .max(MAX_RADIUS_M, `Use a radius of at most ${MAX_RADIUS_M}m.`)
    .default(DEFAULT_RADIUS_M),
  icon: z.enum(placeIcons).default('pin'),
});

/** Every field optional, but at least one must be present. */
export const updatePlaceSchema = createPlaceSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Provide at least one field to change.',
  });

export type CreatePlaceInput = z.infer<typeof createPlaceSchema>;
export type UpdatePlaceInput = z.infer<typeof updatePlaceSchema>;

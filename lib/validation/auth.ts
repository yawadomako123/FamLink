import { z } from 'zod';

/**
 * Auth input schemas, shared by the forms and the server.
 *
 * The password floor is 10 characters with no composition rules. Length is the
 * property that actually resists guessing; forcing a symbol mostly produces
 * "Password1!" and a forgotten credential.
 */
export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters.')
  .max(128, 'That password is too long.');

export const emailSchema = z
  .string()
  .trim()
  .min(1, 'Enter your email address.')
  .pipe(z.email('Enter a valid email address.'))
  .transform((v) => v.toLowerCase());

export const nameSchema = z
  .string()
  .trim()
  .min(1, 'Enter your name.')
  .max(60, 'That name is too long.');

export const registerSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password.'),
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z.object({
  password: passwordSchema,
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

/**
 * Turns a ZodError into a { field: message } map for form rendering.
 * Only the first error per field is kept — showing three at once is noise.
 */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.');
    if (key && !(key in out)) out[key] = issue.message;
  }
  return out;
}

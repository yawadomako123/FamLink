import 'server-only';

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { bearer } from 'better-auth/plugins';

import { db } from '@/lib/db';
import { accounts, sessions, users, verifications } from '@/lib/db/schema';
import { serverEnv, publicEnv } from '@/lib/env';
import { sendEmail } from '@/lib/email';

const env = serverEnv();

/**
 * Better Auth owns authentication end to end — password hashing (scrypt),
 * session issuance, rotation and reset tokens. FamLink deliberately implements
 * none of that itself.
 *
 * The `bearer` plugin is what makes the future Expo client possible: the same
 * API accepts either the session cookie the PWA sends or an
 * `Authorization: Bearer <token>` header from a native app.
 */
export const auth = betterAuth({
  appName: 'FamLink',
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL ?? publicEnv.appUrl,

  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: users,
      session: sessions,
      account: accounts,
      verification: verifications,
    },
  }),

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
    maxPasswordLength: 128,
    /*
     * Email verification is off for the MVP: a family invite is the trust
     * boundary that matters here, and blocking sign-in on an unverified
     * address would strand users when no mail provider is configured.
     */
    requireEmailVerification: false,
    resetPasswordTokenExpiresIn: 60 * 60, // one hour

    sendResetPassword: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: 'Reset your FamLink password',
        text: [
          `Hi ${user.name || 'there'},`,
          '',
          'We received a request to reset your FamLink password.',
          'Open the link below to choose a new one. It expires in one hour.',
          '',
          url,
          '',
          "If you didn't ask for this, you can safely ignore this email — your password will stay the same.",
          '',
          '— FamLink',
        ].join('\n'),
      });
    },
  },

  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24, // refresh the expiry at most once a day
    /*
     * Short-lived signed cookie cache. Keeps the common "who is this request"
     * check off the database without letting a revoked session linger for
     * more than a minute.
     */
    cookieCache: { enabled: true, maxAge: 60 },
  },

  user: {
    changeEmail: { enabled: false },
    deleteUser: { enabled: false },
  },

  advanced: {
    cookiePrefix: 'famlink',
    useSecureCookies: env.NODE_ENV === 'production',
    defaultCookieAttributes: {
      sameSite: 'lax',
      httpOnly: true,
    },
  },

  // Order matters: nextCookies() must come last so it can observe the
  // Set-Cookie headers every other plugin produced.
  plugins: [bearer(), nextCookies()],
});

export type Session = typeof auth.$Infer.Session;
export type AuthUser = (typeof auth.$Infer.Session)['user'];

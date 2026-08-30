import 'server-only';

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { bearer } from 'better-auth/plugins';

import { db } from '@/lib/db';
import { accounts, sessions, users, verifications } from '@/lib/db/schema';
import { serverEnv, publicEnv, isGoogleAuthEnabled } from '@/lib/env';
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

  /*
   * Google, when it is configured. Omitted entirely otherwise, so the provider
   * list never advertises something that cannot complete.
   */
  socialProviders: isGoogleAuthEnabled()
    ? {
        google: {
          clientId: env.GOOGLE_CLIENT_ID!,
          clientSecret: env.GOOGLE_CLIENT_SECRET!,
        },
      }
    : {},

  account: {
    /*
     * Signing in with Google when an account already exists for that address
     * attaches to it rather than creating a second one.
     *
     * Google is trusted for this because it verifies the address itself; the
     * same courtesy must not be extended to a provider that does not, or
     * anyone able to create an account at that provider with somebody else's
     * address could walk into their family.
     */
    accountLinking: {
      enabled: true,
      trustedProviders: ['google'],
    },

    /*
     * OAuth state lives in the database, and the database alone.
     *
     * Better Auth keeps the state server-side either way, but by default it
     * *also* demands a matching cookie on the callback — and that cookie is
     * what made Google sign-in impossible here. It lives five minutes while
     * the record it guards lives ten, so a slow trip through Google's account
     * chooser and two-factor prompt outlives it; and a flow begun inside the
     * installed iOS app can be handed back to Safari, which never had the
     * cookie at all. Measured against production: with the cookie present the
     * callback reached the code exchange, without it the callback died at
     * state verification.
     *
     * What the cookie bought was binding the flow to the browser that began
     * it. Dropping it leaves the state itself as the guard: thirty-two random
     * characters we issue, hold server-side, expire after ten minutes and
     * delete the first time they are redeemed. An attacker needs both a state
     * they cannot predict and a Google code they cannot mint. The risk that
     * remains is login CSRF — being walked into somebody else's account,
     * rather than out of your own — and that is the price of the feature
     * working at all on the devices this family actually uses.
     */
    storeStateStrategy: 'database',
    skipStateCookieCheck: true,
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

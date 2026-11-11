import type { Metadata } from 'next';
import Link from 'next/link';
import { History, Users } from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { Card, CardContent } from '@/components/ui/card';
import { ProfileIdentity } from '@/components/profile/profile-identity';
import { SharingControl } from '@/components/location/sharing-control';
import { SignOutButton } from '@/components/profile/sign-out-button';
import { requireSession } from '@/lib/auth/session';
import { resolveShellData } from '@/lib/families/shell';
import { withSharingExpiry } from '@/lib/location/expiry';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { getMembership } from '@/lib/permissions/family';
import { isAvatarUploadEnabled } from '@/lib/env';

export const metadata: Metadata = { title: 'Profile' };

export default async function ProfilePage() {
  const session = await requireSession('/profile');

  /*
   * The photo is read from the database, not from the session.
   *
   * Sessions are served from a 60-second signed cookie cache (see
   * lib/auth/index.ts), which is the right trade for "who is this request"
   * and the wrong one for a value this screen lets you change. Removing a
   * photo cleared the row and then re-rendered from the cached session, so
   * the old photo and the Remove button came straight back and stayed for up
   * to a minute — looking exactly like the removal had failed. Uploading had
   * the same lag in the other direction.
   */
  const [account] = await db
    .select({ image: users.image })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  const image = account?.image ?? null;
  const { family: current, families, alertCount, unreadMessages } = await resolveShellData(
    session.user.id,
  );

  /*
   * The sharing control is per-family, so it needs this user's membership row
   * — read through the timed-expiry rule, because the switch initialises from
   * `locationSharingState` and a lapsed window leaves that column saying
   * `sharing`. Without this the switch sat in the "on" position after sharing
   * had already ended, which is the one place that lie matters most: it is
   * the member's own account of what they are sharing.
   */
  const raw = current ? await getMembership(session.user.id, current.id) : null;
  const membership = raw ? withSharingExpiry(raw) : null;

  return (
    <AppShell
      user={{ ...session.user, image }}
      familyName={current?.name}
      title="Profile"
      family={current ?? undefined}
      families={families}
      alertCount={alertCount}
      unreadMessages={unreadMessages}
    >
      <div className="px-4 md:px-6 py-6 max-w-2xl space-y-5">
        <ProfileIdentity
          userId={session.user.id}
          name={session.user.name}
          email={session.user.email}
          image={image}
          uploadsEnabled={isAvatarUploadEnabled()}
        />

        {current && membership ? (
          <>
            <h2 className="text-sm font-semibold text-muted uppercase tracking-wider pt-2">
              Privacy
            </h2>
            <SharingControl
              familyId={current.id}
              familyName={current.name}
              initialState={membership.locationSharingState}
              initialVisibility={membership.locationVisibility}
            />
          </>
        ) : (
          <Card>
            <CardContent className="pt-5">
              <p className="text-sm text-muted leading-relaxed">
                Location sharing settings appear once you&rsquo;re part of a family.{' '}
                <Link href="/family" className="font-medium text-on-tint-brand hover:underline">
                  Create or join one
                </Link>
                .
              </p>
            </CardContent>
          </Card>
        )}

        <h2 className="text-sm font-semibold text-muted uppercase tracking-wider pt-2">
          Your data
        </h2>

        <Card>
          <ul className="divide-y divide-line">
            <li>
              <Link
                href="/history"
                className="flex items-center gap-3 px-5 py-4 hover:bg-raised transition-colors"
              >
                <History aria-hidden className="size-4.5 text-muted" />
                <span className="flex-1">
                  <span className="block text-sm font-medium text-fg">My location history</span>
                  <span className="block text-xs text-muted mt-0.5">
                    Only you can see this
                  </span>
                </span>
              </Link>
            </li>
            <li>
              <Link
                href="/family"
                className="flex items-center gap-3 px-5 py-4 hover:bg-raised transition-colors"
              >
                <Users aria-hidden className="size-4.5 text-muted" />
                <span className="flex-1">
                  <span className="block text-sm font-medium text-fg">Family</span>
                  <span className="block text-xs text-muted mt-0.5">
                    {current ? current.name : 'Not in a family yet'}
                  </span>
                </span>
              </Link>
            </li>
          </ul>
        </Card>

        <SignOutButton />
      </div>
    </AppShell>
  );
}

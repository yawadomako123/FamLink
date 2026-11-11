import { NextResponse } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';
import { authedRoute } from '@/lib/api/handler';
import { Errors } from '@/lib/api/errors';
import { db } from '@/lib/db';
import { familyMembers } from '@/lib/db/schema';
import { getPrivate } from '@/lib/blob/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { userId: string };

/**
 * GET — streams somebody's avatar to a person entitled to see it.
 *
 * Avatars live in the same private store as voice notes, so like them they
 * have no address of their own and this is the only way to one.
 *
 * Entitlement here is sharing a family, not merely being signed in. A photo of
 * somebody's child is not something any account should be able to fetch by
 * guessing user ids, and a bare `requireSession` would have allowed exactly
 * that. Fetching your own always works, whatever families you are in.
 */
export const GET = authedRoute<Params>(async (_req, { params, session }) => {
  const { userId } = await params;
  const viewerId = session.user.id;

  if (userId !== viewerId) {
    const mine = db
      .select({ familyId: familyMembers.familyId })
      .from(familyMembers)
      .where(eq(familyMembers.userId, viewerId));

    const [shared] = await db
      .select({ familyId: familyMembers.familyId })
      .from(familyMembers)
      .where(and(eq(familyMembers.userId, userId), inArray(familyMembers.familyId, mine)))
      .limit(1);

    // Indistinguishable from "no such avatar", so this cannot be used to find
    // out whether a given user id exists.
    if (!shared) throw Errors.notFound('That avatar');
  }

  /*
   * Any storage failure is reported as "no avatar", not as a server error.
   *
   * `getPrivate` rethrows everything except a missing blob, so a store that
   * was unreachable, suspended or misconfigured turned every `<img>` on every
   * screen into a 500 — one per member per page, with a stack trace each.
   * Nothing about that is a server fault the viewer can act on, and FamLink
   * already treats generated initials as a perfectly good default rather than
   * a broken state, which is exactly what a 404 here falls back to.
   *
   * A voice note deliberately does not do this: telling somebody their
   * recording is gone when the store is merely unreachable would be a lie
   * about their own data, and there a 500 is the more honest answer.
   */
  let blob: Awaited<ReturnType<typeof getPrivate>>;

  try {
    blob = await getPrivate(`avatars/${userId}`);
  } catch {
    // getPrivate has already logged the detail.
    throw Errors.notFound('That avatar');
  }

  const { stream, headers } = blob;

  return new NextResponse(stream, {
    headers: {
      'Content-Type': headers.get('content-type') ?? 'image/jpeg',
      ...(headers.get('content-length')
        ? { 'Content-Length': headers.get('content-length')! }
        : {}),
      // Private, never shared: the answer depends on who asked.
      'Cache-Control': 'private, max-age=3600',
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});

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

  const { stream, headers } = await getPrivate(`avatars/${userId}`);

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

import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { authedRoute } from '@/lib/api/handler';
import { Errors } from '@/lib/api/errors';
import { db } from '@/lib/db';
import { messages } from '@/lib/db/schema';
import { getPrivate } from '@/lib/blob/store';
import { requireMembership } from '@/lib/permissions/family';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { familyId: string; messageId: string };

/**
 * GET — streams a voice note back to somebody entitled to hear it.
 *
 * Recordings live in a private blob store, which has no address anyone can
 * fetch. This is the only way to them, and it asks two questions first: is the
 * caller in this family, and does the recording actually belong to it. The
 * second matters as much as the first — without the family in the WHERE clause
 * a message id from another household would stream happily to anyone holding
 * it.
 *
 * A deleted message keeps its row and its place in the thread but stops being
 * playable, matching what `listMessages` already does with the text.
 */
export const GET = authedRoute<Params>(async (_req, { params, session }) => {
  const { familyId, messageId } = await params;

  await requireMembership(session.user.id, familyId);

  const [message] = await db
    .select({
      audioPath: messages.audioPath,
      deletedAt: messages.deletedAt,
    })
    .from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.familyId, familyId)))
    .limit(1);

  if (!message?.audioPath || message.deletedAt) throw Errors.notFound('That recording');

  const { stream, headers } = await getPrivate(message.audioPath);

  return new NextResponse(stream, {
    headers: {
      'Content-Type': headers.get('content-type') ?? 'audio/webm',
      ...(headers.get('content-length')
        ? { 'Content-Length': headers.get('content-length')! }
        : {}),
      /*
       * Cached by the browser but never by a shared cache: the response is
       * only correct for the family member who asked for it, and a CDN copy
       * would be served to whoever came next.
       */
      'Cache-Control': 'private, max-age=3600',
      // Played, not downloaded, and never interpreted as anything but audio.
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});

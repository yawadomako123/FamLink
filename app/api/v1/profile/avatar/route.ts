import { deletePrivate, putPrivate } from '@/lib/blob/store';
import { eq } from 'drizzle-orm';
import { authedRoute, ok } from '@/lib/api/handler';
import { enforceRateLimit } from '@/lib/api/rate-limit';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { Errors } from '@/lib/api/errors';
import { isAvatarUploadEnabled } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 4 * 1024 * 1024;
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'] as const;

/**
 * POST /api/v1/profile/avatar — upload a profile picture.
 *
 * Avatar upload is optional infrastructure. Without BLOB_READ_WRITE_TOKEN this
 * returns a clear 503 rather than a stack trace, and the UI hides the control
 * — FamLink falls back to generated initials avatars, which is a perfectly
 * good default rather than a broken state.
 */
export const POST = authedRoute(async (req, { session }) => {
  if (!isAvatarUploadEnabled()) {
    throw Errors.badRequest('Photo uploads are not configured for this deployment.');
  }

  enforceRateLimit('mutation', session.user.id);

  const form = await req.formData();
  const file = form.get('file');

  if (!(file instanceof File)) throw Errors.badRequest('Expected an image file.');
  if (file.size > MAX_BYTES) {
    throw Errors.badRequest('That image is larger than 4MB. Please choose a smaller one.');
  }

  // Trust the sniffed type, not the filename extension.
  if (!ALLOWED.includes(file.type as (typeof ALLOWED)[number])) {
    throw Errors.badRequest('Please upload a JPEG, PNG or WebP image.');
  }

  const blob = await putPrivate(`avatars/${session.user.id}`, file, {
    contentType: file.type,
    // The path is derived from the user id, so a new upload replaces the old.
    allowOverwrite: true,
    addRandomSuffix: false,
  });

  /*
   * The stored value is a route on this app, not a blob address. The store is
   * private, so there is no address to store — and routing through here means
   * an avatar is only served to somebody signed in.
   */
  const image = `/api/v1/profile/avatar/${session.user.id}?v=${Date.now()}`;

  await db
    .update(users)
    .set({ image, updatedAt: new Date() })
    .where(eq(users.id, session.user.id));

  void blob;

  return ok({ image });
});

/**
 * DELETE /api/v1/profile/avatar — take the photo down.
 *
 * There was no way to do this. A photo could be replaced but never removed,
 * so somebody who uploaded a picture of their child and thought better of it
 * had no way back short of uploading something else over the top. For a
 * family app that is the wrong answer, and it is the same principle as
 * deleting a voice note: whatever you put in, you can take out.
 *
 * The stored reference is cleared first, because that is what the person
 * asked for and it must not depend on the blob store cooperating. The
 * recording of the failure is a log line, not an error — the photo is already
 * unreachable, since the only route to it reads `users.image`.
 */
export const DELETE = authedRoute(async (_req, { session }) => {
  enforceRateLimit('mutation', session.user.id);

  await db
    .update(users)
    .set({ image: null, updatedAt: new Date() })
    .where(eq(users.id, session.user.id));

  try {
    await deletePrivate(`avatars/${session.user.id}`);
  } catch (error) {
    console.error('[avatar] could not remove a deleted photo', error);
  }

  return ok({ image: null });
});

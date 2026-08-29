import 'server-only';

import {
  BlobAccessError,
  BlobClientTokenExpiredError,
  BlobContentTypeNotAllowedError,
  BlobError,
  BlobStoreNotFoundError,
  BlobNotFoundError,
  BlobStoreSuspendedError,
  get,
  put,
  type PutCommandOptions,
} from '@vercel/blob';
import { Errors } from '@/lib/api/errors';

/**
 * Uploads to Vercel Blob, and says something useful when it cannot.
 *
 * ## Why this wrapper exists
 *
 * A misconfigured blob store surfaced as "Something went wrong on our end" —
 * the generic 500 any unhandled error produces. That is the right message for
 * a genuine fault and the wrong one for a deployment that is merely set up
 * incorrectly: it tells whoever set it up nothing, and gives them nowhere to
 * look. Diagnosing one such failure took a request-by-request bisection of the
 * route's own validation from the outside.
 *
 * The store's *access mode* is the trap worth naming. Vercel offers Private as
 * the recommended default, and FamLink cannot use it: avatars and voice notes
 * are read straight from `<img src>` and `<audio src>`, which send no
 * authorization header. A private store accepts the token and passes every
 * check this app makes, then rejects the write.
 *
 * The SDK's typed errors are matched rather than its message strings, so this
 * keeps working when the wording changes.
 */

/** Recognises the store-configuration failures worth naming to the caller. */
function describeBlobFailure(error: unknown): string | null {
  if (error instanceof BlobAccessError) {
    return 'The blob store rejected this upload. Check the store’s access mode.';
  }

  if (error instanceof BlobClientTokenExpiredError) {
    return 'The blob store credentials have expired. Reconnect the store to this project.';
  }

  if (error instanceof BlobStoreNotFoundError) {
    return 'The configured blob store no longer exists.';
  }

  if (error instanceof BlobStoreSuspendedError) {
    return 'The blob store is suspended. Check its usage limits in Vercel.';
  }

  if (error instanceof BlobContentTypeNotAllowedError) {
    return 'The blob store refused that file type.';
  }

  return null;
}

/**
 * Uploads privately, returning the pathname to store.
 *
 * Private, not public, and deliberately so. A public blob is readable by
 * anyone holding its URL, for ever, with no reference to who they are — which
 * is the wrong bargain for a family's recorded voice. These are readable only
 * through an endpoint that checks family membership first, so a link that
 * leaks is worth nothing outside the family.
 *
 * The pathname is what callers keep. There is no URL to keep: a private blob
 * has no address anyone can fetch directly.
 *
 * The underlying error is always logged in full, tagged with its class — the
 * caller gets a sentence, the logs get the detail.
 */
export async function putPrivate(
  pathname: string,
  body: Parameters<typeof put>[1],
  options: Omit<PutCommandOptions, 'access'>,
): Promise<{ pathname: string }> {
  try {
    const blob = await put(pathname, body, { ...options, access: 'private' });
    return { pathname: blob.pathname };
  } catch (error) {
    console.error('[blob] upload failed', {
      pathname,
      kind: error instanceof Error ? error.constructor.name : typeof error,
      isBlobError: error instanceof BlobError,
      message: error instanceof Error ? error.message : String(error),
    });

    const explanation = describeBlobFailure(error);
    if (explanation) throw Errors.badRequest(explanation);

    /*
     * An unrecognised blob failure is still a storage problem, not a bug in
     * the caller — say so, and carry the provider's own wording. It names a
     * misconfiguration, never anything belonging to a user.
     */
    if (error instanceof BlobError) {
      throw Errors.badRequest(`Blob storage rejected the upload: ${error.message}`);
    }

    throw error;
  }
}

/**
 * Reads a private blob back.
 *
 * The caller is responsible for having established that whoever is asking is
 * allowed to — this function knows nothing about families. It exists so the
 * SDK's error vocabulary is translated in one place rather than two.
 */
export async function getPrivate(pathname: string) {
  try {
    const result = await get(pathname, { access: 'private' });

    // The SDK resolves to null for a pathname that is simply not there.
    if (!result) throw Errors.notFound('That recording');

    return result;
  } catch (error) {
    if (error instanceof BlobNotFoundError) throw Errors.notFound('That recording');

    console.error('[blob] read failed', {
      pathname,
      kind: error instanceof Error ? error.constructor.name : typeof error,
      message: error instanceof Error ? error.message : String(error),
    });

    throw error;
  }
}

import 'server-only';

import {
  BlobAccessError,
  BlobClientTokenExpiredError,
  BlobContentTypeNotAllowedError,
  BlobError,
  BlobStoreNotFoundError,
  BlobStoreSuspendedError,
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
    return (
      'This deployment’s blob store rejected the upload. If the store was ' +
      'created with Private access, create one with Public access instead — ' +
      'FamLink reads avatars and voice notes straight from their URL.'
    );
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
 * `put`, with the failure translated.
 *
 * The underlying error is always logged in full, tagged with its class — the
 * caller gets a sentence, the logs get the detail.
 */
export async function putPublic(
  pathname: string,
  body: Parameters<typeof put>[1],
  options: Omit<PutCommandOptions, 'access'>,
) {
  try {
    return await put(pathname, body, { ...options, access: 'public' });
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

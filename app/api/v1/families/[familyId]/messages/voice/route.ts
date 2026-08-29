import { put } from '@vercel/blob';
import { authedRoute, ok } from '@/lib/api/handler';
import { enforceRateLimit } from '@/lib/api/rate-limit';
import { Errors } from '@/lib/api/errors';
import { MAX_VOICE_NOTE_MS, sendMessage } from '@/lib/chat/service';
import { requireMembership } from '@/lib/permissions/family';
import { isAvatarUploadEnabled } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Two minutes of Opus is comfortably under this; it is a guard, not a target. */
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Accepted recording types.
 *
 * Browsers disagree about what MediaRecorder produces — Chrome and Firefox
 * give WebM/Opus, Safari gives MP4/AAC — and the codec suffix varies, so the
 * check is on the base type rather than the full string.
 */
const ALLOWED = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac'];

/**
 * POST — upload a recording and post it as a message.
 *
 * The upload and the message are one request rather than two. A separate
 * "upload then send" would leave an orphaned blob behind every time somebody
 * closed the tab between the two, and nothing would ever collect it.
 */
export const POST = authedRoute<{ familyId: string }>(async (req, { params, session }) => {
  const { familyId } = await params;

  // Checked before doing any work, so a non-member cannot use this to find out
  // whether a family exists.
  await requireMembership(session.user.id, familyId);

  if (!isAvatarUploadEnabled()) {
    throw Errors.badRequest('Voice notes are not configured for this deployment.');
  }

  enforceRateLimit('message', session.user.id);

  const form = await req.formData();
  const file = form.get('file');
  const durationMs = Number(form.get('durationMs'));

  if (!(file instanceof File)) throw Errors.badRequest('Expected an audio recording.');
  if (file.size > MAX_BYTES) throw Errors.badRequest('That recording is too large.');

  const baseType = file.type.split(';')[0]?.trim() ?? '';
  if (!ALLOWED.includes(baseType)) {
    throw Errors.badRequest('That audio format is not supported.');
  }

  if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > MAX_VOICE_NOTE_MS) {
    throw Errors.badRequest(
      `Voice notes can be up to ${Math.round(MAX_VOICE_NOTE_MS / 1000)} seconds long.`,
    );
  }

  /*
   * A random suffix, unlike avatars: every note is its own recording and must
   * never overwrite an earlier one still referenced by a message in the thread.
   */
  const blob = await put(`voice/${familyId}/${session.user.id}`, file, {
    access: 'public',
    contentType: baseType,
    addRandomSuffix: true,
  });

  const message = await sendMessage(session.user.id, familyId, '', {
    url: blob.url,
    durationMs: Math.round(durationMs),
  });

  return ok({ message }, { status: 201 });
});

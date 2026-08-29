'use client';

import * as React from 'react';
import { Loader2, Mic, Pause, Play, Square, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * The parts of chat that deal in sound and in who is about to speak.
 *
 * Kept out of `chat-view` because none of it touches the thread: the recorder
 * owns a MediaRecorder and a microphone, the player owns an audio element, and
 * the indicator owns nothing at all.
 */

/** The longest recording the composer will make. Mirrors MAX_VOICE_NOTE_MS. */
export const MAX_RECORDING_MS = 2 * 60 * 1000;

/** Below this a "recording" is a mis-tap, not a message. */
const MIN_RECORDING_MS = 500;

/** mm:ss, from milliseconds. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/* -------------------------------------------------------------------------- */

/** Names whoever is composing, in the gap above the composer. */
export function TypingIndicator({
  typing,
}: {
  typing: Record<string, { name: string; at: number }>;
}) {
  const names = Object.values(typing).map((t) => t.name);
  if (names.length === 0) return null;

  const label =
    names.length === 1
      ? `${names[0]} is typing…`
      : names.length === 2
        ? `${names[0]} and ${names[1]} are typing…`
        : `${names[0]} and ${names.length - 1} others are typing…`;

  return (
    <div
      /*
       * Polite, not assertive. This must never interrupt a screen reader
       * mid-message just because somebody started typing.
       */
      aria-live="polite"
      className="shrink-0 px-4 pb-1 flex items-center gap-1.5 text-xs text-muted"
    >
      <span aria-hidden className="flex gap-0.5">
        {[0, 150, 300].map((delay) => (
          <span
            key={delay}
            className="size-1 rounded-full bg-subtle animate-bounce"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </span>
      <span className="truncate">{label}</span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Records a voice note and posts it.
 *
 * `MediaRecorder` output differs by browser — WebM/Opus on Chrome and Firefox,
 * MP4/AAC on Safari — so nothing here names a container. Whatever the browser
 * produces is uploaded with its own MIME type, and the server accepts the set
 * they actually emit rather than insisting on one.
 */
export function VoiceRecorder({
  familyId,
  disabled,
  onSent,
  onError,
}: {
  familyId: string;
  disabled: boolean;
  onSent: () => void;
  onError: (message: string) => void;
}) {
  const [recording, setRecording] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [elapsed, setElapsed] = React.useState(0);

  const recorderRef = React.useRef<MediaRecorder | null>(null);
  const startedAt = React.useRef(0);
  const discarded = React.useRef(false);

  /*
   * Feature detection that hydrates cleanly.
   *
   * The server has no MediaRecorder, so the server snapshot is `false` and the
   * first client paint agrees with the markup; the real answer arrives on the
   * next tick. Nothing here ever changes, hence the no-op subscribe.
   */
  const supported = React.useSyncExternalStore(
    () => () => {},
    () =>
      typeof MediaRecorder !== 'undefined' &&
      typeof navigator.mediaDevices?.getUserMedia === 'function',
    () => false,
  );

  React.useEffect(() => {
    if (!recording) return;

    const timer = setInterval(() => {
      const ms = Date.now() - startedAt.current;
      setElapsed(ms);
      // Stops itself, rather than letting a forgotten recording run on.
      if (ms >= MAX_RECORDING_MS) recorderRef.current?.stop();
    }, 200);

    return () => clearInterval(timer);
  }, [recording]);

  const upload = React.useCallback(
    async (blob: Blob, durationMs: number) => {
      setUploading(true);

      try {
        const form = new FormData();
        form.append('file', blob, 'voice-note');
        form.append('durationMs', String(Math.round(durationMs)));

        const response = await fetch(`/api/v1/families/${familyId}/messages/voice`, {
          method: 'POST',
          body: form,
        });

        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? 'Could not send that voice note.');
        }

        onSent();
      } catch (err) {
        onError(err instanceof Error ? err.message : 'Could not send that voice note.');
      } finally {
        setUploading(false);
      }
    },
    [familyId, onSent, onError],
  );

  async function start() {
    discarded.current = false;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };

      recorder.onstop = () => {
        // Releasing the tracks is what turns the browser's recording dot off.
        stream.getTracks().forEach((track) => track.stop());
        setRecording(false);

        const durationMs = Date.now() - startedAt.current;
        if (discarded.current || chunks.length === 0 || durationMs < MIN_RECORDING_MS) return;

        void upload(new Blob(chunks, { type: recorder.mimeType }), durationMs);
      };

      recorderRef.current = recorder;
      startedAt.current = Date.now();
      setElapsed(0);
      setRecording(true);
      recorder.start();
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      onError(
        name === 'NotAllowedError'
          ? 'FamLink needs permission to use your microphone to record a voice note.'
          : name === 'NotFoundError'
            ? 'No microphone was found on this device.'
            : 'Could not start recording.',
      );
    }
  }

  if (!supported) return null;

  if (recording) {
    return (
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={() => {
            discarded.current = true;
            recorderRef.current?.stop();
          }}
          aria-label="Discard recording"
          className="size-11 rounded-xl flex items-center justify-center text-muted hover:text-fg hover:bg-raised transition-colors"
        >
          <Trash2 aria-hidden className="size-5" />
        </button>

        <span
          aria-live="polite"
          className="text-xs tabular-nums text-danger-600 font-medium w-10 text-center"
        >
          {formatElapsed(elapsed)}
        </span>

        <Button
          type="button"
          onClick={() => recorderRef.current?.stop()}
          aria-label="Send voice note"
          className="size-11 rounded-xl p-0 shrink-0"
        >
          <Square aria-hidden className="size-4 fill-current" />
        </Button>
      </div>
    );
  }

  return (
    <Button
      type="button"
      variant="secondary"
      onClick={() => void start()}
      disabled={disabled || uploading}
      aria-label="Record a voice note"
      title="Record a voice note"
      className="size-11 rounded-xl p-0 shrink-0"
    >
      {uploading ? (
        <Loader2 aria-hidden className="size-5 animate-spin" />
      ) : (
        <Mic aria-hidden className="size-5" />
      )}
    </Button>
  );
}

/* -------------------------------------------------------------------------- */

/** Plays a voice note inside a message bubble. */
export function VoiceNote({
  url,
  durationMs,
  mine,
}: {
  url: string;
  durationMs: number | null;
  mine: boolean;
}) {
  const ref = React.useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = React.useState(false);
  const [position, setPosition] = React.useState(0);

  const total = durationMs ?? 0;
  const progress = total > 0 ? Math.min(100, (position / total) * 100) : 0;

  return (
    <div className="flex items-center gap-2.5 min-w-45">
      <button
        type="button"
        onClick={() => {
          const el = ref.current;
          if (!el) return;
          if (el.paused) void el.play().catch(() => {});
          else el.pause();
        }}
        aria-label={playing ? 'Pause voice note' : 'Play voice note'}
        className={cn(
          'size-9 shrink-0 rounded-full flex items-center justify-center transition-colors',
          mine ? 'bg-white/20 text-white hover:bg-white/30' : 'bg-raised text-fg hover:bg-inset',
        )}
      >
        {playing ? (
          <Pause aria-hidden className="size-4" />
        ) : (
          <Play aria-hidden className="size-4 ml-0.5" />
        )}
      </button>

      <div className="flex-1 min-w-0">
        <div className={cn('h-1 rounded-full overflow-hidden', mine ? 'bg-white/25' : 'bg-inset')}>
          <div
            className={cn('h-full rounded-full', mine ? 'bg-white' : 'bg-brand-600')}
            style={{ width: `${progress}%` }}
          />
        </div>
        <span
          className={cn(
            'text-[11px] tabular-nums mt-1 block',
            mine ? 'text-white/75' : 'text-muted',
          )}
        >
          {formatElapsed(position > 0 ? position : total)}
        </span>
      </div>

      <audio
        ref={ref}
        src={url}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setPosition(0);
        }}
        onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime * 1000)}
      />
    </div>
  );
}

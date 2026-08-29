/**
 * iOS audio session handling.
 *
 * ## Why this exists
 *
 * On iOS, leaving the app during a call silenced the other person until you
 * came back. Safari classifies a page's audio by guesswork, and a WebRTC page
 * looks like a media player — which iOS is entitled to suspend the moment it
 * stops being frontmost. A phone call is not a podcast, and the platform has no
 * way to tell the difference unless it is told.
 *
 * `navigator.audioSession` (Safari 16.4+) is that telling. `play-and-record`
 * declares the page is doing two-way live audio, which keeps the session alive
 * in the background and routes it the way a call should be routed.
 *
 * Absent everywhere else, and absent on older iOS, so every use is guarded.
 * Where it does not exist nothing changes: the call behaves exactly as it did.
 */

/** Not in lib.dom yet. Narrow to what is actually touched. */
interface AudioSessionCapableNavigator extends Navigator {
  audioSession?: {
    type:
      | 'auto'
      | 'playback'
      | 'transient'
      | 'transient-solo'
      | 'ambient'
      | 'play-and-record';
  };
}

export type AudioSessionType = NonNullable<
  AudioSessionCapableNavigator['audioSession']
>['type'];

function session() {
  if (typeof navigator === 'undefined') return undefined;
  return (navigator as AudioSessionCapableNavigator).audioSession;
}

/** Whether this browser lets a page declare what its audio is for. */
export function supportsAudioSession(): boolean {
  return session() !== undefined;
}

/**
 * Declares the page's audio intent, returning a function that restores the
 * previous value.
 *
 * Restoring matters: leaving a whole browser tab in `play-and-record` after a
 * call has ended keeps the microphone route claimed, and the next page to play
 * audio inherits a session set up for a phone call.
 */
export function claimAudioSession(type: AudioSessionType = 'play-and-record'): () => void {
  const current = session();
  if (!current) return () => {};

  const previous = current.type;

  try {
    current.type = type;
  } catch {
    // Some builds expose the object but reject assignment. Not worth failing a
    // call over — the audio still works, it just suspends in the background.
    return () => {};
  }

  return () => {
    try {
      current.type = previous;
    } catch {
      // Nothing useful to do; the page is going away regardless.
    }
  };
}

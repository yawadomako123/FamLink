'use client';

import * as React from 'react';

export type RingtoneType = 'incoming' | 'outgoing';

/**
 * Synthesizes telephone ringtones using the Web Audio API.
 * This avoids requiring external audio files and loads instantly.
 */
export function useRingtone(type: RingtoneType, active: boolean) {
  React.useEffect(() => {
    if (!active) return;

    // Safely check for AudioContext support
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContext) return;

    let ctx: AudioContext;
    try {
      ctx = new AudioContext();
    } catch {
      // AudioContext creation can fail in some strict environments without interaction
      return;
    }

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gainNode = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    osc1.type = 'sine';
    osc2.type = 'sine';

    // Standard US ring frequencies
    osc1.frequency.value = 440;
    osc2.frequency.value = 480;

    // A lowpass filter softens the harshness of pure sine waves
    filter.type = 'lowpass';
    filter.frequency.value = 1000;

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(ctx.destination);

    // Muted by default
    gainNode.gain.value = 0;

    /*
     * Mobile browsers hand back a suspended context when there has been no
     * user gesture — which is exactly the case for an incoming call. Without
     * this the phone rings silently.
     */
    void ctx.resume().catch(() => {});

    osc1.start();
    osc2.start();

    let interval: ReturnType<typeof setInterval>;

    if (type === 'incoming') {
      // Fast pulsing for incoming (0.4s on, 0.2s off, 0.4s on, 2s off)
      const playSequence = () => {
        const t = ctx.currentTime;
        gainNode.gain.setValueAtTime(0, t);
        gainNode.gain.setValueAtTime(0.5, t + 0.1);
        gainNode.gain.setValueAtTime(0.5, t + 0.5);
        gainNode.gain.setValueAtTime(0, t + 0.6);

        gainNode.gain.setValueAtTime(0, t + 0.8);
        gainNode.gain.setValueAtTime(0.5, t + 0.9);
        gainNode.gain.setValueAtTime(0.5, t + 1.3);
        gainNode.gain.setValueAtTime(0, t + 1.4);
      };

      playSequence();
      interval = setInterval(playSequence, 3400);
    } else {
      // Slower pulsing for outgoing (2s on, 4s off)
      const playSequence = () => {
        const t = ctx.currentTime;
        gainNode.gain.setValueAtTime(0, t);
        gainNode.gain.setValueAtTime(0.1, t + 0.1); // lower volume for outgoing
        gainNode.gain.setValueAtTime(0.1, t + 2.0);
        gainNode.gain.setValueAtTime(0, t + 2.1);
      };

      playSequence();
      interval = setInterval(playSequence, 6000);
    }

    return () => {
      clearInterval(interval);
      try {
        osc1.stop();
        osc2.stop();
        ctx.close().catch(() => {});
      } catch {
        // Ignore teardown errors
      }
    };
  }, [type, active]);
}

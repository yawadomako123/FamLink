'use client';

import * as React from 'react';

/**
 * Choosing where call audio comes out.
 *
 * ## What this can and cannot do
 *
 * The only web API for routing audio is `HTMLMediaElement.setSinkId`, which
 * picks one of the *system's* output devices — headphones, a speaker, a USB
 * headset. It is implemented in Chromium browsers on desktop and nowhere else.
 *
 * In particular there is no way to ask a phone for "earpiece" versus
 * "loudspeaker": iOS Safari implements neither `setSinkId` nor
 * `enumerateDevices` for outputs, and Android's Chrome exposes the phone's
 * routing as a single default device. On a phone the operating system decides,
 * and it follows whatever the user has plugged in or paired.
 *
 * So the picker is offered where it works and hidden where it does not, rather
 * than shown everywhere as a control that quietly does nothing.
 */

/** `setSinkId` is not in every TypeScript DOM lib yet. */
type SinkCapableElement = HTMLMediaElement & {
  setSinkId?: (sinkId: string) => Promise<void>;
};

export interface AudioOutputOption {
  deviceId: string;
  label: string;
}

export interface UseAudioOutputResult {
  /** Empty when the browser cannot route audio; hide the control then. */
  devices: AudioOutputOption[];
  deviceId: string;
  select: (deviceId: string) => void;
  supported: boolean;
}

export function useAudioOutput(enabled: boolean): UseAudioOutputResult {
  const [devices, setDevices] = React.useState<AudioOutputOption[]>([]);
  const [deviceId, setDeviceId] = React.useState('');

  const supported =
    typeof window !== 'undefined' &&
    typeof HTMLMediaElement !== 'undefined' &&
    'setSinkId' in HTMLMediaElement.prototype;

  React.useEffect(() => {
    if (!enabled || !supported) return;

    let cancelled = false;

    const read = async () => {
      try {
        const all = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;

        setDevices(
          all
            .filter((d) => d.kind === 'audiooutput')
            .map((d, i) => ({
              deviceId: d.deviceId,
              // Labels are blank until some device permission is granted. A
              // call has already asked for the microphone, so they are
              // normally present — but a numbered fallback beats a blank row.
              label: d.label || `Output ${i + 1}`,
            })),
        );
      } catch {
        // Enumeration is best-effort; without it the control simply hides.
      }
    };

    void read();

    // Plugging in headphones mid-call should offer them.
    navigator.mediaDevices.addEventListener('devicechange', read);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener('devicechange', read);
    };
  }, [enabled, supported]);

  return {
    devices,
    deviceId,
    select: setDeviceId,
    supported: supported && devices.length > 1,
  };
}

/**
 * Points one media element at the chosen output.
 *
 * Failures are swallowed on purpose: a device can disappear between being
 * listed and being selected, and the audio keeps playing on the default
 * output, which is the right outcome.
 */
export function applyAudioOutput(element: HTMLMediaElement, deviceId: string): void {
  if (!deviceId) return;

  const sinkable = element as SinkCapableElement;
  if (typeof sinkable.setSinkId !== 'function') return;

  void sinkable.setSinkId(deviceId).catch(() => {});
}

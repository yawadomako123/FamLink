import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge conditional class names, with later Tailwind utilities winning. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * The first character of a word, counted in what a reader would call a
 * character rather than in UTF-16 code units.
 *
 * `name[0]` splits an emoji down the middle. "👨‍👩‍👧 Family" produced a lone
 * high surrogate followed by "F", which renders as a replacement character —
 * and emoji in names is not a hypothetical here, FamLink already has families
 * named with them.
 *
 * `Intl.Segmenter` understands that a flag, a skin tone or a ZWJ family is one
 * grapheme. Where it is missing, `Array.from` at least keeps astral characters
 * whole, which covers almost everything the naive index broke.
 */
function firstGraphemes(word: string, count: number): string {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    const out: string[] = [];
    for (const { segment } of segmenter.segment(word)) {
      out.push(segment);
      if (out.length === count) break;
    }
    return out.join('');
  }

  return Array.from(word).slice(0, count).join('');
}

/** Initials for the fallback avatar, e.g. "Ama Boateng" -> "AB". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';

  const take = (word: string, count: number) => firstGraphemes(word, count).toUpperCase();

  if (parts.length === 1) return take(parts[0]!, 2);
  return take(parts[0]!, 1) + take(parts[parts.length - 1]!, 1);
}

/**
 * Deterministic accent colour per user, so a person keeps the same colour
 * across the member list, the map marker and the chat bubbles.
 */
const AVATAR_COLORS = [
  '#128472',
  '#2563eb',
  '#7c3aed',
  '#c2410c',
  '#0891b2',
  '#a21caf',
  '#4d7c0f',
  '#b45309',
] as const;

export function avatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]!;
}

import { describe, expect, it } from 'vitest';
import { avatarColor, initials } from '@/lib/utils';

/**
 * The fallback avatar.
 *
 * Uploads are optional in FamLink, so generated initials are the common case
 * rather than an error state — every member list, map marker and chat bubble
 * leans on them.
 */

describe('initials', () => {
  it('takes the first and last name', () => {
    expect(initials('Ama Boateng')).toBe('AB');
    expect(initials('Kwabena Osei-Bonsu Frimpong')).toBe('KF');
  });

  it('takes two letters from a single name', () => {
    expect(initials('Yaw')).toBe('YA');
  });

  it('copes with stray whitespace', () => {
    expect(initials('  Ama   Boateng  ')).toBe('AB');
    expect(initials('\tAma\nBoateng ')).toBe('AB');
  });

  it('falls back rather than returning nothing', () => {
    expect(initials('')).toBe('?');
    expect(initials('   ')).toBe('?');
  });

  /*
   * The bug this guards against: indexing a string by UTF-16 code unit splits
   * an emoji in half. "👨‍👩‍👧 Family" produced a lone high surrogate followed
   * by "F", which renders as a replacement character. FamLink already has
   * families named with emoji, so this is not hypothetical.
   */
  it('never splits a character in half', () => {
    const lonelySurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/;

    for (const name of [
      '👨‍👩‍👧 Family',
      '❤️💕',
      '🇬🇭 Ghana',
      '👋🏾 Ama',
      'Ama 👨‍👩‍👧‍👦',
    ]) {
      const result = initials(name);
      expect(result, `${name} produced a broken string: ${JSON.stringify(result)}`).not.toMatch(
        lonelySurrogate,
      );
      expect(result.length).toBeGreaterThan(0);
    }
  });

  it('keeps a whole emoji as the initial', () => {
    // One grapheme from each of two words.
    expect(initials('❤️ Corners')).toBe('❤️C');
  });

  it('leaves accented letters intact', () => {
    expect(initials('Zoë')).toBe('ZO');
    expect(initials('Zoë Mensah')).toBe('ZM');
  });
});

describe('avatarColor', () => {
  it('gives the same person the same colour every time', () => {
    const seed = 'wSYZmbwq83fM7JWnT6GBkZByIX3gLhRR';

    expect(avatarColor(seed)).toBe(avatarColor(seed));
  });

  it('always returns a colour, whatever the seed', () => {
    for (const seed of ['', 'a', 'Ama Boateng', '👨‍👩‍👧', 'x'.repeat(500)]) {
      expect(avatarColor(seed)).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('spreads a realistic set of ids across more than one colour', () => {
    const colours = new Set(
      Array.from({ length: 40 }, (_, i) => avatarColor(`user-id-${i}`)),
    );

    expect(colours.size).toBeGreaterThan(1);
  });
});

import { describe, expect, it } from 'vitest';

import {
  buildLinqDeepLink,
  createLinqLinkCode,
  extractLinqLinkCode,
  LINQ_LINK_CODE_ALPHABET,
  LINQ_LINK_CODE_LENGTH,
  LINQ_LINK_CODE_PATTERN,
  normalizeLinqNumber,
} from './deep-link';

describe('normalizeLinqNumber', () => {
  it('strips the punctuation people paste around an international number', () => {
    expect(normalizeLinqNumber('+1 (555) 000-2222')).toBe('+15550002222');
    expect(normalizeLinqNumber('  +1-555-000-2222  ')).toBe('+15550002222');
    expect(normalizeLinqNumber('+447700900123')).toBe('+447700900123');
  });

  it('completes a national-format number from the default country code', () => {
    expect(normalizeLinqNumber('555 000 2222', { defaultCountryCode: '1' })).toBe('+15550002222');
    // A leading `0` is a trunk prefix, not part of the subscriber number.
    expect(normalizeLinqNumber('07700 900123', { defaultCountryCode: '+44' })).toBe(
      '+447700900123',
    );
  });

  it('refuses input it cannot normalize rather than guessing', () => {
    // A national number with no default country code is ambiguous.
    expect(normalizeLinqNumber('555 000 2222')).toBeUndefined();
    expect(normalizeLinqNumber('')).toBeUndefined();
    expect(normalizeLinqNumber('not a number')).toBeUndefined();
    // Too short and too long for E.164.
    expect(normalizeLinqNumber('+1234567')).toBeUndefined();
    expect(normalizeLinqNumber('+1234567890123456')).toBeUndefined();
  });
});

describe('link codes', () => {
  it('mints a code in the advertised shape', () => {
    const code = createLinqLinkCode();

    expect(code).toMatch(LINQ_LINK_CODE_PATTERN);
    expect(code).toHaveLength(3 + LINQ_LINK_CODE_LENGTH);
    // No glyphs that are mistyped when read off a screen.
    expect(code.slice(3)).not.toMatch(/[ILO01]/);
  });

  it('keeps the matcher in step with the alphabet it draws from', () => {
    // The pattern spells the alphabet as ranges while the minter walks the
    // string, so pin them together: every mintable glyph matches…
    for (const glyph of LINQ_LINK_CODE_ALPHABET) {
      const sample = `LH-${glyph.repeat(LINQ_LINK_CODE_LENGTH)}`;
      expect(extractLinqLinkCode(sample), `expected ${JSON.stringify(sample)} to match`).toBe(
        sample,
      );
    }
    // …and none of the excluded ambiguous ones does.
    for (const glyph of 'ILO01') {
      const sample = `LH-${glyph.repeat(LINQ_LINK_CODE_LENGTH)}`;
      expect(extractLinqLinkCode(sample), `expected ${JSON.stringify(sample)} not to match`).toBe(
        undefined,
      );
    }
  });

  it('does not repeat across a burst of mints', () => {
    const codes = new Set(Array.from({ length: 200 }, () => createLinqLinkCode()));
    expect(codes.size).toBe(200);
  });

  it('extracts a code from the message a person actually sends', () => {
    const code = createLinqLinkCode();

    expect(extractLinqLinkCode(`hey, linking now ${code}`)).toBe(code);
    // Case-insensitive: a person typing the code by hand still links.
    expect(extractLinqLinkCode(code.toLowerCase())).toBe(code);
    expect(extractLinqLinkCode(`Hi! ${code}.`)).toBe(code);
  });

  it('returns undefined when no code is present', () => {
    expect(extractLinqLinkCode('just saying hello')).toBeUndefined();
    expect(extractLinqLinkCode('')).toBeUndefined();
    expect(extractLinqLinkCode(undefined)).toBeUndefined();
    // A longer token that merely contains the prefix is not a code.
    expect(extractLinqLinkCode('X LH-ABCD2345Z')).toBeUndefined();
  });
});

describe('buildLinqDeepLink', () => {
  it('builds both link schemes off the normalized number', () => {
    const link = buildLinqDeepLink({ number: '+1 (555) 000-2222' });

    expect(link).toEqual({
      imessage: 'imessage:+15550002222',
      number: '+15550002222',
      sms: 'sms:+15550002222',
    });
  });

  it('prefills the one-time code so the inbound message is attributable', () => {
    const code = createLinqLinkCode();
    const link = buildLinqDeepLink({ code, message: 'Link my agent', number: '+15550002222' });

    expect(link!.body).toBe(`Link my agent ${code}`);
    // Both platforms' delimiter, and the body survives URL-encoding.
    expect(link!.sms).toBe(`sms:+15550002222?&body=${encodeURIComponent(`Link my agent ${code}`)}`);
    expect(link!.imessage).toBe(
      `imessage:+15550002222?&body=${encodeURIComponent(`Link my agent ${code}`)}`,
    );
  });

  it('round-trips: what the deep link prefills is what the inbound extractor finds', () => {
    const code = createLinqLinkCode();
    const link = buildLinqDeepLink({ code, number: '+15550002222' });

    expect(link!.body).toBe(code);
    expect(extractLinqLinkCode(link!.body)).toBe(code);
  });

  it('omits the body when there is nothing to prefill, and refuses a bad number', () => {
    expect(buildLinqDeepLink({ number: '+15550002222' })).not.toHaveProperty('body');
    expect(buildLinqDeepLink({ number: 'who knows' })).toBeUndefined();
  });
});

/**
 * Linq deep links — how a person *starts* the conversation.
 *
 * LobeHub never opens a chat with a number that has not messaged it first:
 * cold outreach on iMessage is the fastest way to get a carrier number flagged
 * and blocked. The phone link is therefore user-initiated — the product hands
 * the person a `sms:` / `imessage:` link pointing at one of LobeHub's shared
 * pool numbers, the person sends it from their own phone, and that first
 * inbound message is what the signed webhook (and the messenger behind it)
 * reacts to.
 *
 * Pool numbers are interchangeable: inbound routes by the *sender's* handle,
 * never by which pool number received it. Carrying a one-time **link code** in
 * the first message is what makes that sender attributable: a cold `"hello"`
 * from an unknown handle cannot be matched to a LobeHub account, but
 * `"LH-7Q2M4XKP"` can. This module owns the three primitives that
 * flow — the code codec, the E.164 normalization the URI needs, and the URI
 * builders themselves — so every client (web, desktop, mobile, CLI) produces
 * byte-identical links.
 *
 * Deliberately pure: no I/O, no clock, no crypto beyond the CSPRNG used to mint
 * a code. Issuing, storing and expiring a code is the binding flow's job.
 */

import { randomBytes } from 'node:crypto';

/** Marker that makes a link code recognizable inside an arbitrary message body. */
export const LINQ_LINK_CODE_PREFIX = 'LH-';

/**
 * Code alphabet without the glyphs people mistype when reading a code off a
 * screen: `I`/`L`, `O`/`0`, and `1`. 31 symbols × 8 chars ≈ 47 bits, which is
 * far beyond what a short-lived, single-use code needs.
 *
 * {@link LINQ_LINK_CODE_PATTERN} spells the same set as ranges; `deep-link.test.ts`
 * pins the two together so they cannot drift.
 */
export const LINQ_LINK_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Number of random symbols in a link code (excluding the prefix). */
export const LINQ_LINK_CODE_LENGTH = 8;

/**
 * Matches a link code anywhere in a message, case-insensitively. Boundary
 * anchored so a longer token that merely contains the prefix is not mistaken
 * for a code.
 */
export const LINQ_LINK_CODE_PATTERN = new RegExp(
  `\\b${LINQ_LINK_CODE_PREFIX}[A-HJKMNP-Z2-9]{${LINQ_LINK_CODE_LENGTH}}\\b`,
  'i',
);

/**
 * Mint a link code.
 *
 * Uses the CSPRNG, not `Math.random`: the code is what a person's first inbound
 * message is attributed by, so a guessable code would let one phone number
 * claim another person's link.
 */
export const createLinqLinkCode = (): string => {
  const bytes = randomBytes(LINQ_LINK_CODE_LENGTH);
  let code = '';
  for (const byte of bytes) code += LINQ_LINK_CODE_ALPHABET[byte % LINQ_LINK_CODE_ALPHABET.length];
  return `${LINQ_LINK_CODE_PREFIX}${code}`;
};

/**
 * Pull a link code out of an inbound message body.
 *
 * Returns the normalized (upper-case) code so a person typing the code by hand
 * in lower case still links, or `undefined` when the message carries none.
 */
export const extractLinqLinkCode = (text: string | null | undefined): string | undefined => {
  if (typeof text !== 'string' || text.length === 0) return undefined;
  const match = text.match(LINQ_LINK_CODE_PATTERN);
  return match ? match[0].toUpperCase() : undefined;
};

export interface LinqNumberOptions {
  /**
   * Country calling code (digits only, no `+`) assumed when the input carries
   * no `+`. Without it a national-format number is ambiguous, so normalization
   * refuses rather than guessing.
   */
  defaultCountryCode?: string;
}

/**
 * Normalize a phone number to E.164, or return `undefined` when it cannot be.
 *
 * Accepts the formatting people actually paste — `+1 (555) 000-2222`,
 * `+1-555-000-2222`, `555 000 2222` with a default country code — and rejects
 * anything whose digit count cannot be E.164.
 */
export const normalizeLinqNumber = (
  raw: string,
  options: LinqNumberOptions = {},
): string | undefined => {
  if (typeof raw !== 'string') return undefined;

  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  const digits = trimmed.replaceAll(/\D/g, '');
  if (!digits) return undefined;

  let e164: string;
  if (trimmed.startsWith('+')) {
    e164 = digits;
  } else {
    const country = options.defaultCountryCode?.replaceAll(/\D/g, '');
    if (!country) return undefined;
    // A leading `0` is a national trunk prefix, not part of the subscriber
    // number; drop it before prepending the country code.
    e164 = `${country}${digits.replace(/^0+/, '')}`;
  }

  // E.164 caps a full number at 15 digits; 8 is the shortest real one.
  if (!/^\d{8,15}$/.test(e164)) return undefined;

  return `+${e164}`;
};

export interface LinqDeepLinkInput extends LinqNumberOptions {
  /** One-time code the first message should carry, e.g. from {@link createLinqLinkCode}. */
  code?: string;
  /** Optional human-readable line placed before the code. */
  message?: string;
  /** Number the person should text — any number from the shared Linq pool. */
  number: string;
}

export interface LinqDeepLink {
  /** Prefilled message body; present only when `message` and/or `code` was given. */
  body?: string;
  /** `imessage:` variant — opens Messages directly on Apple devices. */
  imessage: string;
  /** The E.164 number both links point at. */
  number: string;
  /** `sms:` variant — the cross-platform fallback. */
  sms: string;
}

/**
 * Build the pair of links a person taps to start (or resume) a phone link.
 *
 * The `?&body=` delimiter is deliberate rather than sloppy: iOS expects
 * `...&body=`, Android expects `...?body=`, and the doubled delimiter is the
 * form both platforms accept. Returns `undefined` for an unusable number so a
 * caller cannot render a broken link.
 */
export const buildLinqDeepLink = (input: LinqDeepLinkInput): LinqDeepLink | undefined => {
  const number = normalizeLinqNumber(input.number, {
    defaultCountryCode: input.defaultCountryCode,
  });
  if (!number) return undefined;

  const body = [input.message?.trim(), input.code?.trim()].filter(Boolean).join(' ').trim();

  // `encodeURIComponent` keeps the body a single query value — a raw space or
  // `&` would otherwise truncate the prefilled message.
  const suffix = body ? `?&body=${encodeURIComponent(body)}` : '';

  return {
    ...(body ? { body } : {}),
    imessage: `imessage:${number}${suffix}`,
    number,
    sms: `sms:${number}${suffix}`,
  };
};

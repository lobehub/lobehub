import { primaryColorsSwatches } from '@lobehub/ui';

/**
 * Characters that already read as a whole word on their own — one of them is
 * enough for an avatar, two would be unreadable at 16px.
 */
const IDEOGRAPH = /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF]/;
const WORD_SEPARATOR = /[\s_\-–—./\\|:,()[\]{}]+/;
const LATIN_LETTER = /[a-z]/i;

/**
 * Pick the glyphs that stand in for a missing image: the leading ideograph for
 * CJK names, the initials of the first two words for latin ones, and the
 * leading emoji when the name starts with one (the Avatar renders it as a
 * fluent emoji instead of text).
 */
export const getAvatarInitials = (name?: string | null): string => {
  const text = name?.trim();
  if (!text) return '';

  const [first] = [...text];
  if (IDEOGRAPH.test(first)) return first;
  if (!LATIN_LETTER.test(first) && !/\d/.test(first)) return first;

  const words = text.split(WORD_SEPARATOR).filter(Boolean);
  if (words.length > 1) return (words[0][0] + words[1][0]).toUpperCase();

  return words[0].slice(0, 2).toUpperCase();
};

/**
 * Deterministic FNV-1a so the same name always lands on the same swatch — an
 * agent keeps its color across sessions, devices and list positions.
 */
const hash = (seed: string): number => {
  let value = 0x81_1c_9d_c5;
  for (let i = 0; i < seed.length; i++) {
    value ^= seed.codePointAt(i)!;
    value = Math.imul(value, 0x01_00_01_93);
  }
  return Math.abs(value);
};

export const getAvatarBackground = (seed?: string | null): string | undefined => {
  const text = seed?.trim();
  if (!text) return undefined;

  return primaryColorsSwatches[hash(text) % primaryColorsSwatches.length];
};

/**
 * Selectors hand a literal `'transparent'` (or `rgba(0,0,0,0)`) down as "no
 * color chosen". Behind a real image that is correct; behind fallback initials
 * it renders unreadable text on the page background, so it counts as absent.
 */
const BLANK_BACKGROUNDS = new Set(['transparent', 'rgba(0,0,0,0)', 'none']);

const usableBackground = (background?: string): string | undefined => {
  const value = background?.trim();
  if (!value) return undefined;

  return BLANK_BACKGROUNDS.has(value.replaceAll(' ', '').toLowerCase()) ? undefined : value;
};

const REMOTE_AVATAR = /^(?:https?:|\/|data:|blob:|file:|app:)/;

/** The avatar URL we have to probe, if the avatar is one at all. */
export const remoteAvatarSrc = (avatar: unknown): string | undefined =>
  typeof avatar === 'string' && REMOTE_AVATAR.test(avatar) ? avatar : undefined;

interface ResolveAvatarParams<T> {
  avatar?: T;
  background?: string;
  /** The avatar is a URL and the browser failed to load it. */
  isBroken?: boolean;
  name?: string;
  title?: string;
}

/**
 * Decide what the Avatar actually renders. A missing or broken image falls back
 * to the name's initials over a hashed background, so the avatar still carries
 * the identity instead of collapsing into an anonymous grey box.
 */
export const resolveAvatar = <T>({
  avatar,
  background,
  isBroken,
  name,
  title,
}: ResolveAvatarParams<T>): { avatar: T | string; background?: string } => {
  if (avatar && !isBroken) return { avatar, background };

  const label = name || title;

  return {
    // Only a real name makes initials; a URL would render as its own first
    // character ("/"), which says even less than an empty tile.
    avatar: getAvatarInitials(label),
    background:
      usableBackground(background) || getAvatarBackground(label || remoteAvatarSrc(avatar)),
  };
};

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
 * Selectors hand a literal `'transparent'` (or `rgba(0,0,0,0)`) down as "no
 * color chosen". Behind a real image that is correct; behind fallback initials
 * it renders unreadable text on the page background, so it counts as absent —
 * dropping it lets the Avatar fall back to its neutral `colorBorder` tile.
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
 * to the name's initials, so the avatar still carries the identity. The tile
 * itself stays neutral unless a background was explicitly chosen — a color
 * derived from the name reads as meaningful when it isn't.
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
    // No explicit color means no color: the Avatar paints its own `colorBorder`
    // tile, the same neutral grey every unconfigured avatar gets.
    background: usableBackground(background),
  };
};

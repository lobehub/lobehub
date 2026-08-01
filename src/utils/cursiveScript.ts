/**
 * Arabic-script languages (Persian, Arabic, Urdu, …) need contiguous text runs
 * for cursive joining. Per-character DOM nodes break that shaping.
 */
export const textNeedsCursiveJoining = (text: string): boolean => /\p{Script=Arabic}/u.test(text);

/** Grapheme-safe split (emoji / combining marks). Falls back to code points. */
export const splitGraphemes = (text: string): string[] => {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    return Array.from(
      new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text),
      (part) => part.segment,
    );
  }
  return Array.from(text);
};

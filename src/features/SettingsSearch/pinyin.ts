/** Whether the text contains Han characters that pinyin search applies to */
export const containsHan = (text: string) => /\p{Script=Han}/u.test(text);

/** Returns lowercase pinyin variants (full spelling + initials) for Han text */
export type PinyinTexts = (text: string) => string[];

let loader: Promise<PinyinTexts | null> | undefined;

/**
 * Lazily load pinyin-pro so users can hit Chinese labels with pinyin queries
 * (e.g. `zhuti` / `zt` → 主题). The package is mostly dictionary weight, so it
 * is dynamically imported only when the built index actually contains Han text
 * (see useSettingsSearch) — non-CJK locales never pay for it. pinyin-pro over
 * lighter char-table converters for its per-word polyphone segmentation
 * (充值 → chongzhi, where a char table can only guess per character). The
 * default dict still drifts on some words (重置 → zhongzhi, not chongzhi);
 * that residue is compensated by Fuse fuzzy matching — see matcher.test.ts —
 * so don't tighten the Fuse threshold without re-checking polyphone queries.
 * Resolves null if the chunk fails to load; search then works without pinyin.
 */
export const loadPinyinTexts = (): Promise<PinyinTexts | null> => {
  loader ??= import('pinyin-pro').then(
    ({ pinyin }) =>
      (text: string) => {
        if (!containsHan(text)) return [];

        const syllables = pinyin(text, { nonZh: 'removed', toneType: 'none', type: 'array' });
        if (syllables.length === 0) return [];

        const full = syllables.join('');
        const initials = syllables.map((syllable) => syllable[0]).join('');
        // A single-letter initials text would fuzzy-match nearly any query
        return initials.length > 1 ? [full, initials] : [full];
      },
    () => null,
  );
  return loader;
};

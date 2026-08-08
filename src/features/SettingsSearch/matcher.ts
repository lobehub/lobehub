import Fuse from 'fuse.js';

export interface SearchableEntry {
  /** Lowercased searchable texts (label / desc / keywords / pinyin variants) */
  haystack: string[];
}

/**
 * Fuzzy matches crowd a small sidebar panel fast, so cap how many we show —
 * anything below the top 20 is noise for a settings query.
 */
export const MAX_SEARCH_RESULTS = 20;

/**
 * Fuzzy matcher over the settings index. Compared to the ChatInput Fuse usages
 * (threshold 0.3–0.4 over short command labels), the settings haystack includes
 * longer description texts, so `ignoreLocation` keeps matches deep inside a
 * description from being scored away; threshold 0.35 tolerates a typo or two
 * without flooding the panel with unrelated entries. Results are score-sorted,
 * and Fuse keeps insertion order on ties — the index lists tab entries first,
 * so tabs still rank above item-level matches when equally relevant.
 */
export const createSettingsSearchFuse = <T extends SearchableEntry>(entries: T[]) =>
  new Fuse(entries, {
    ignoreLocation: true,
    keys: ['haystack'],
    threshold: 0.35,
  });

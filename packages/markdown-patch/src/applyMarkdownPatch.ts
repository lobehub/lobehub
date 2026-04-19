import type { MarkdownPatchHunk, MarkdownPatchResult } from './types';

const countOccurrences = (source: string, needle: string): number => {
  if (!needle) return 0;

  let count = 0;
  let from = 0;
  while (true) {
    const idx = source.indexOf(needle, from);
    if (idx === -1) break;
    count += 1;
    from = idx + needle.length;
  }
  return count;
};

/**
 * Apply a list of byte-exact SEARCH/REPLACE hunks to a markdown document.
 *
 * Semantics:
 * - Each hunk's `search` must appear verbatim in the current document.
 * - Whitespace, punctuation, casing differences are not tolerated.
 * - If `search` appears multiple times, caller must set `replaceAll: true`,
 *   otherwise the hunk is rejected as ambiguous.
 * - Hunks are applied sequentially; later hunks see earlier results.
 * - First error aborts the whole patch; no partial application is committed.
 */
export const applyMarkdownPatch = (
  source: string,
  hunks: MarkdownPatchHunk[],
): MarkdownPatchResult => {
  if (!Array.isArray(hunks) || hunks.length === 0) {
    return { error: { code: 'EMPTY_HUNKS', hunkIndex: -1 }, ok: false };
  }

  let current = source;
  let applied = 0;

  for (const [hunkIndex, hunk] of hunks.entries()) {
    if (!hunk.search) {
      return { error: { code: 'EMPTY_SEARCH', hunkIndex }, ok: false };
    }

    const occurrences = countOccurrences(current, hunk.search);

    if (occurrences === 0) {
      return {
        error: { code: 'HUNK_NOT_FOUND', hunkIndex, search: hunk.search },
        ok: false,
      };
    }

    if (occurrences > 1 && !hunk.replaceAll) {
      return {
        error: { code: 'HUNK_AMBIGUOUS', hunkIndex, occurrences },
        ok: false,
      };
    }

    current = hunk.replaceAll
      ? current.split(hunk.search).join(hunk.replace)
      : current.replace(hunk.search, hunk.replace);

    applied += hunk.replaceAll ? occurrences : 1;
  }

  return { applied, content: current, ok: true };
};

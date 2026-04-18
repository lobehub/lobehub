import type { MarkdownPatchErrorDetail } from './types';

export const formatMarkdownPatchError = (error: MarkdownPatchErrorDetail): string => {
  const idx = error.hunkIndex;
  switch (error.code) {
    case 'EMPTY_HUNKS': {
      return 'No hunks provided. Include at least one { search, replace } entry.';
    }
    case 'EMPTY_SEARCH': {
      return `Hunk #${idx} has empty search. Provide a non-empty substring to locate.`;
    }
    case 'HUNK_NOT_FOUND': {
      return `Hunk #${idx} search not found. Ensure the search string matches the current document byte-exact (whitespace, punctuation, casing). Re-read the document if unsure.`;
    }
    case 'HUNK_AMBIGUOUS': {
      const n = error.occurrences ?? 0;
      return `Hunk #${idx} search matches ${n} locations. Add surrounding context to uniquify, or set replaceAll=true to replace every occurrence.`;
    }
  }
};

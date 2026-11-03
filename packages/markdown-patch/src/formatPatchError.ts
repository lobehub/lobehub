import type { MarkdownPatchErrorDetail } from './types';

export const formatMarkdownPatchError = (error: MarkdownPatchErrorDetail): string => {
  const idx = error.hunkIndex;
  switch (error.code) {
    case 'EMPTY_HUNKS': {
      return 'No hunks provided. Include at least one hunk (replace / delete / deleteLines / insertAt / replaceLines).';
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
    case 'INVALID_LINE_RANGE': {
      return `Hunk #${idx} has endLine < startLine. Use inclusive 1-based line numbers where endLine >= startLine.`;
    }
    case 'LINE_OUT_OF_RANGE': {
      const total = error.totalLines ?? 0;
      return `Hunk #${idx} references a line outside [1, ${total}] (insertAt may also target line ${total + 1} to append). Re-check the injected document's line numbers.`;
    }
    case 'LINE_OVERLAP': {
      return `Hunk #${idx} overlaps another line-based hunk in the same call. Split them across multiple updateDocument calls or merge them into one hunk.`;
    }
  }
};

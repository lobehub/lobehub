import { findFoldedMatches } from '@/utils/findInDom';

export interface HighlightSegment {
  match: boolean;
  text: string;
}

/** Splits `text` into plain and matching runs of a case-insensitive `keyword`. */
export const splitHighlightSegments = (text: string, keyword: string): HighlightSegment[] => {
  const matches = findFoldedMatches(text, keyword.trim().toLowerCase());
  if (matches.length === 0) return [{ match: false, text }];

  const segments: HighlightSegment[] = [];
  let cursor = 0;
  for (const [start, end] of matches) {
    if (start > cursor) segments.push({ match: false, text: text.slice(cursor, start) });
    segments.push({ match: true, text: text.slice(start, end) });
    cursor = end;
  }
  if (cursor < text.length) segments.push({ match: false, text: text.slice(cursor) });

  return segments;
};

import { findFoldedMatches } from '@/utils/findInDom';

export interface HighlightSegment {
  match: boolean;
  text: string;
}

const MAX_HIGHLIGHT_TERMS = 16;

const splitTerms = (query: string) =>
  [
    ...new Set(
      query
        .toLowerCase()
        .replaceAll('-', ' ')
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, MAX_HIGHLIGHT_TERMS),
    ),
  ].sort((left, right) => right.length - left.length);

export const splitQueryHighlightSegments = (text: string, query: string): HighlightSegment[] => {
  const ranges: [number, number][] = [];
  for (const term of splitTerms(query)) {
    for (const [start, end] of findFoldedMatches(text, term)) {
      const overlaps = ranges.some(
        ([takenStart, takenEnd]) => start < takenEnd && end > takenStart,
      );
      if (!overlaps) ranges.push([start, end]);
    }
  }
  if (ranges.length === 0) return [{ match: false, text }];

  ranges.sort(([left], [right]) => left - right);
  const segments: HighlightSegment[] = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start > cursor) segments.push({ match: false, text: text.slice(cursor, start) });
    segments.push({ match: true, text: text.slice(start, end) });
    cursor = end;
  }
  if (cursor < text.length) segments.push({ match: false, text: text.slice(cursor) });

  return segments;
};

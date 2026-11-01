export interface HighlightSegment {
  match: boolean;
  text: string;
}

/** Splits `text` into plain and matching runs of a case-insensitive `keyword`. */
export const splitHighlightSegments = (text: string, keyword: string): HighlightSegment[] => {
  const needle = keyword.trim().toLowerCase();
  const haystack = text.toLowerCase();
  // A case fold that changes the length would shift every offset below.
  if (!needle || haystack.length !== text.length) return [{ match: false, text }];

  const segments: HighlightSegment[] = [];
  let cursor = 0;
  for (let index = haystack.indexOf(needle); index !== -1;) {
    if (index > cursor) segments.push({ match: false, text: text.slice(cursor, index) });
    segments.push({ match: true, text: text.slice(index, index + needle.length) });
    cursor = index + needle.length;
    index = haystack.indexOf(needle, cursor);
  }
  if (cursor < text.length) segments.push({ match: false, text: text.slice(cursor) });

  return segments;
};

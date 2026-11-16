const ELLIPSIS = '...';
const MAX_QUERY_TERMS = 48;
const MAX_OCCURRENCES_PER_TERM = 200;
const CJK_ONLY = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+$/u;

interface TermOccurrence {
  end: number;
  start: number;
  term: string;
}

const uniqueTerms = (query: string) => [
  ...new Set(
    query
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((term) => term.toLowerCase()),
  ),
];

/** The search engine segments CJK text, so a long CJK term can match without appearing verbatim. */
const toCjkBigrams = (terms: string[]) => [
  ...new Set(
    terms
      .filter((term) => term.length > 2 && CJK_ONLY.test(term))
      .flatMap((term) =>
        Array.from({ length: term.length - 1 }, (_, index) => term.slice(index, index + 2)),
      ),
  ),
];

const findOccurrences = (content: string, terms: string[]): TermOccurrence[] =>
  terms
    .slice(0, MAX_QUERY_TERMS)
    .flatMap((term) => {
      const pattern = new RegExp(term.replaceAll(/[$()*+.?[\\\]^{|}]/g, '\\$&'), 'giu');
      const occurrences: TermOccurrence[] = [];

      for (const match of content.matchAll(pattern)) {
        occurrences.push({ end: match.index + match[0].length, start: match.index, term });
        if (occurrences.length >= MAX_OCCURRENCES_PER_TERM) break;
      }

      return occurrences;
    })
    .sort((a, b) => a.start - b.start);

/** Find the earliest span no wider than `maxLength` that covers the most distinct terms. */
const findBestSpan = (occurrences: TermOccurrence[], maxLength: number) => {
  const counts = new Map<string, number>();
  let left = 0;
  // A term wider than the window is clamped, or the left edge would pass the current occurrence.
  const clampedEnd = ({ end, start }: TermOccurrence) => Math.min(end, start + maxLength);
  let best = { end: clampedEnd(occurrences[0]), start: occurrences[0].start };
  let bestCoverage = 0;

  for (const occurrence of occurrences) {
    counts.set(occurrence.term, (counts.get(occurrence.term) ?? 0) + 1);

    const end = clampedEnd(occurrence);

    while (end - occurrences[left].start > maxLength) {
      const { term } = occurrences[left];
      const remaining = counts.get(term)! - 1;
      if (remaining === 0) counts.delete(term);
      else counts.set(term, remaining);
      left += 1;
    }

    if (counts.size > bestCoverage) {
      bestCoverage = counts.size;
      best = { end, start: occurrences[left].start };
    }
  }

  return best;
};

const truncateHead = (content: string, maxLength: number) => content.slice(0, maxLength) + ELLIPSIS;

/**
 * Build the excerpt a knowledge-base search hit shows, centered on the query terms.
 *
 * The result is at most `maxLength` characters plus one ellipsis. It starts at the document head
 * when no term can be located, because a stemmed or analyzed match need not appear verbatim.
 */
export const buildMatchSnippet = (
  content: string | null | undefined,
  query: string,
  maxLength: number,
): string | null => {
  if (!content) return null;
  if (content.length <= maxLength) return content;

  const terms = uniqueTerms(query);
  let occurrences = findOccurrences(content, terms);
  if (occurrences.length === 0) occurrences = findOccurrences(content, toCjkBigrams(terms));
  if (occurrences.length === 0) return truncateHead(content, maxLength);

  // The leading ellipsis comes out of the window, so the result still fits `maxLength` + one ellipsis.
  const windowLength = maxLength - ELLIPSIS.length;
  const span = findBestSpan(occurrences, windowLength);
  const padding = Math.floor((windowLength - (span.end - span.start)) / 2);
  const start = Math.max(0, Math.min(span.start - padding, content.length - windowLength));

  if (start === 0) return truncateHead(content, maxLength);

  const windowEnd = start + windowLength;
  const body = content.slice(start, windowEnd);

  return windowEnd < content.length ? ELLIPSIS + body + ELLIPSIS : ELLIPSIS + body;
};

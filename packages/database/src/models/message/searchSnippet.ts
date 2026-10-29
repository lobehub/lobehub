const ELLIPSIS = '…';

export interface MessageSearchSnippet {
  matchCount: number;
  snippet: string;
}

/**
 * Excerpt of `content` around the first case-insensitive occurrence of
 * `keyword`, with whitespace collapsed so a multi-line message reads as one
 * line in a result list. Falls back to the head of the text when the database
 * matched a case fold JavaScript does not reproduce.
 */
export const buildMessageSearchSnippet = (
  content: string,
  keyword: string,
  radius = 60,
): MessageSearchSnippet => {
  const text = content.replaceAll(/\s+/g, ' ').trim();
  const needle = keyword.replaceAll(/\s+/g, ' ').trim().toLowerCase();
  const haystack = text.toLowerCase();

  let matchCount = 0;
  if (needle) {
    for (let index = haystack.indexOf(needle); index !== -1;) {
      matchCount += 1;
      index = haystack.indexOf(needle, index + needle.length);
    }
  }

  const firstMatch = needle ? haystack.indexOf(needle) : -1;
  const start = Math.max(0, (firstMatch === -1 ? 0 : firstMatch) - radius);
  const end = Math.min(
    text.length,
    (firstMatch === -1 ? 0 : firstMatch + needle.length) + radius * (firstMatch === -1 ? 2 : 1),
  );

  return {
    matchCount,
    snippet: `${start > 0 ? ELLIPSIS : ''}${text.slice(start, end)}${end < text.length ? ELLIPSIS : ''}`,
  };
};

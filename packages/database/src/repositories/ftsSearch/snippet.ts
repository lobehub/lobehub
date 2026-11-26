import { inArray, sql } from 'drizzle-orm';

import { documents } from '../../schemas';
import type { LobeChatDatabase } from '../../type';

const SNIPPET_MAX_LEAD_CHARS = 40;
const SNIPPET_MAX_TERMS = 16;

// Matches beyond this prefix fall back to the opening text instead of loading the whole document.
export const FTS_SEARCH_SNIPPET_SCAN_CHARS = 200_000;

const splitTerms = (query: string) => [
  ...new Set(
    query
      .toLowerCase()
      .replaceAll('-', ' ')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, SNIPPET_MAX_TERMS),
  ),
];

const withEllipsis = (text: string, start: number, maxLength: number) => {
  const end = start + maxLength;
  return `${start > 0 ? '...' : ''}${text.slice(start, end)}${end < text.length ? '...' : ''}`;
};

export const buildMatchSnippet = (
  content: string | null | undefined,
  query: string,
  maxLength: number = 160,
): string | null => {
  if (!content) return null;

  const text = content
    .replaceAll(/\s*\n\s*/g, '\n')
    .replaceAll(/[^\S\n]+/g, ' ')
    .trim();
  if (!text) return null;

  const lowerText = text.toLowerCase();
  let matchAt = -1;
  for (const term of splitTerms(query)) {
    const index = lowerText.indexOf(term);
    if (index !== -1 && (matchAt === -1 || index < matchAt)) matchAt = index;
  }

  const lead = Math.min(SNIPPET_MAX_LEAD_CHARS, Math.floor(maxLength / 4));
  if (matchAt <= lead) return withEllipsis(text, 0, maxLength);

  let start = matchAt - lead;
  const wordBreak = text.slice(start, matchAt).search(/\s/);
  if (wordBreak !== -1) start += wordBreak + 1;

  return withEllipsis(text, start, maxLength);
};

export const loadDocumentSnippets = async (
  db: LobeChatDatabase,
  documentIds: string[],
  query: string,
): Promise<Map<string, string>> => {
  if (documentIds.length === 0) return new Map();

  const rows = await db
    .select({
      content: sql<string | null>`left(${documents.content}, ${FTS_SEARCH_SNIPPET_SCAN_CHARS})`,
      id: documents.id,
    })
    .from(documents)
    .where(inArray(documents.id, documentIds));

  const snippets = new Map<string, string>();
  for (const row of rows) {
    const snippet = buildMatchSnippet(row.content, query);
    if (snippet) snippets.set(row.id, snippet);
  }
  return snippets;
};

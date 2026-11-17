import pMap from 'p-map';

import type { FtsSearchKnowledgeBaseDocumentHit } from '@/database/repositories/ftsSearch';

/** Each keyword is one more full-text query, so a long keyword list stays bounded. */
const MAX_KEYWORDS = 6;
/** Keyword queries hit the search backend; keep only a few in flight at once. */
const KEYWORD_SEARCH_CONCURRENCY = 3;

/** Whitespace-separated keywords, deduplicated case-insensitively, in query order. */
export const splitKeywords = (query: string): string[] => {
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const keyword of query.trim().split(/\s+/)) {
    const key = keyword.toLowerCase();
    if (!keyword || seen.has(key)) continue;
    seen.add(key);
    keywords.push(keyword);
  }
  return keywords;
};

/**
 * Every full-text provider matches a multi-word query only when one field holds every word, while
 * agents search with keyword bags that mix languages ("环境变量 OPENAI_API_KEY 配置") — so a page
 * holding two of three words never surfaces. This is the fallback for a query that matched nothing
 * that way: search each keyword on its own and rank pages by how many keywords they hold, then by
 * summed relevance. Returns nothing for a single-keyword query, which the strict search already ran.
 */
export const searchAnyKeyword = async (
  query: string,
  limit: number,
  search: (keyword: string) => Promise<FtsSearchKnowledgeBaseDocumentHit[]>,
): Promise<FtsSearchKnowledgeBaseDocumentHit[]> => {
  const keywords = splitKeywords(query).slice(0, MAX_KEYWORDS);
  if (keywords.length < 2) return [];

  const settled = await pMap(
    keywords,
    (keyword): Promise<PromiseSettledResult<FtsSearchKnowledgeBaseDocumentHit[]>> =>
      search(keyword).then(
        (value) => ({ status: 'fulfilled', value }),
        (reason: unknown) => ({ reason, status: 'rejected' }),
      ),
    { concurrency: KEYWORD_SEARCH_CONCURRENCY },
  );
  const merged = new Map<
    string,
    { hit: FtsSearchKnowledgeBaseDocumentHit; matched: number; relevance: number }
  >();
  for (const result of settled) {
    if (result.status !== 'fulfilled') continue;
    for (const hit of result.value) {
      const entry = merged.get(hit.documentId);
      if (entry) {
        entry.matched += 1;
        entry.relevance += hit.relevance;
      } else {
        merged.set(hit.documentId, { hit, matched: 1, relevance: hit.relevance });
      }
    }
  }

  // One keyword the provider rejects must not hide the others' hits; all of them failing is a
  // real search failure.
  const failure = settled.find((result) => result.status === 'rejected');
  if (merged.size === 0 && failure) throw failure.reason;

  return [...merged.values()]
    .sort((a, b) => b.matched - a.matched || b.relevance - a.relevance)
    .slice(0, limit)
    .map(({ hit, relevance }) => ({ ...hit, relevance }));
};

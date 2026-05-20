const BM25_BOOLEAN_OPERATORS = new Set(['AND', 'OR', 'NOT']);
const BM25_MAX_TERMS = 48;

// NOTICE:
// This utility is used by multiple lexical search paths. We keep safe defaults
// to prevent parser-hostile queries (for example, huge tool-output payloads
// containing many boolean-like tokens), while exposing options so specific
// call sites can tune behavior if they have stricter/looser requirements.
export interface SanitizeBm25QueryOptions {
  dropBooleanOperators?: boolean;
  maxTerms?: number;
}

export const SAFE_BM25_QUERY_OPTIONS: Required<SanitizeBm25QueryOptions> = {
  dropBooleanOperators: true,
  maxTerms: BM25_MAX_TERMS,
};

const normalizeBm25Terms = (query: string, options: SanitizeBm25QueryOptions = {}) => {
  const { dropBooleanOperators = false, maxTerms } = options;
  const terms = query
    .trim()
    .replaceAll('-', ' ')
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => !dropBooleanOperators || !BM25_BOOLEAN_OPERATORS.has(word.toUpperCase()))
    .filter(Boolean);

  return typeof maxTerms === 'number' ? terms.slice(0, Math.max(1, maxTerms)) : terms;
};

/**
 * Escape special tantivy query syntax characters and join terms with AND
 * so all words must match (instead of Tantivy's default OR behavior).
 */
export function sanitizeBm25Query(query: string, options: SanitizeBm25QueryOptions = {}): string {
  const terms = normalizeBm25Terms(query, options)
    // NOTICE:
    // Keep `<` and `>` in this escape set. Angle-bracket wrapped tokens can be
    // interpreted as range-query boundaries by the BM25 parser and may trigger
    // parse failures when the boundary contains multiple terms.
    //
    // TODO: Migrate remaining parser-string BM25 call sites to `paradedb.match(field, value, conjunction_mode => true)`
    // like `packages/database/src/models/userMemory/query.ts`. `paradedb.match`
    // tokenizes raw text and avoids maintaining this Tantivy query-language
    // escape list for user/tool/chat payloads.
    .map((word) => word.replaceAll(/[+&|!(){}[\]^"'`~*?:\\/<>]/g, '\\$&'));

  if (terms.length === 0) throw new Error('Query is empty after sanitization');

  return terms.join(' AND ');
}

/**
 * Normalizes raw text before passing it to ParadeDB `paradedb.match`.
 *
 * Before:
 * - "I'm checking curl -H X-API-Key AND OR NOT"
 *
 * After:
 * - "I'm checking curl H X API Key"
 *
 * Use when:
 * - The search path should let ParadeDB tokenize raw text instead of parsing Tantivy query syntax
 * - The caller still needs safe query-size limits for long tool or chat payloads
 *
 * Expects:
 * - Raw user/chat text, not pre-escaped Tantivy query syntax
 * - Options matching the BM25 search path risk profile
 *
 * Returns:
 * - Whitespace-joined terms suitable for `paradedb.match(field, value, conjunction_mode => true)`
 */
export function normalizeBm25MatchQuery(
  query: string,
  options: SanitizeBm25QueryOptions = {},
): string {
  const terms = normalizeBm25Terms(query, options);

  if (terms.length === 0) throw new Error('Query is empty after normalization');

  return terms.join(' ');
}

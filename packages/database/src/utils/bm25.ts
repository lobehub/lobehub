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

/**
 * Escape special tantivy query syntax characters and join terms with AND
 * so all words must match (instead of Tantivy's default OR behavior).
 */
export function sanitizeBm25Query(query: string, options: SanitizeBm25QueryOptions = {}): string {
  const { dropBooleanOperators = false, maxTerms } = options;
  const terms = query
    .trim()
    .replaceAll('-', ' ') // treat hyphens as word separators (ICU tokenizer does the same)
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => !dropBooleanOperators || !BM25_BOOLEAN_OPERATORS.has(word.toUpperCase()))
    // NOTICE:
    // Keep `<` and `>` in this escape set. Angle-bracket wrapped tokens can be
    // interpreted as range-query boundaries by the BM25 parser and may trigger
    // parse failures when the boundary contains multiple terms.
    .map((word) => word.replaceAll(/[+&|!(){}[\]^"~*?:\\/<>]/g, '\\$&'))
    .filter(Boolean);

  if (terms.length === 0) throw new Error('Query is empty after sanitization');

  if (typeof maxTerms === 'number') {
    return terms.slice(0, Math.max(1, maxTerms)).join(' AND ');
  }

  return terms.join(' AND ');
}

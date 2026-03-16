/**
 * Escape special tantivy query syntax characters and join terms with AND
 * so all words must match (instead of Tantivy's default OR behavior).
 */
export function sanitizeBm25Query(query: string): string {
  const terms = query
    .trim()
    .split(/\s+/)
    .map((word) => word.replaceAll(/[+\-&|!(){}[\]^"~*?:\\/]/g, '\\$&'))
    .filter(Boolean);

  if (terms.length === 0) throw new Error('Query is empty after sanitization');

  return terms.join(' AND ');
}

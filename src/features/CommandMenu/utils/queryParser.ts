export interface ParsedQuery {
  /**
   * The cleaned query string without modifiers
   */
  cleanQuery: string;
  /**
   * The detected type filter (if any)
   */
  typeFilter?: ValidSearchType;
}

// Valid types for search filtering
// Note: 'pageContent' is excluded as it's not yet integrated in the backend
const VALID_TYPES = [
  'agent',
  'topic',
  'message',
  'file',
  'page',
  'mcp',
  'plugin',
  'communityAgent',
] as const;

export type ValidSearchType = (typeof VALID_TYPES)[number];

/**
 * Parse search query to extract type filters and clean query
 *
 * Supported syntax:
 * - `type:agent search query` - Filter by type
 * - `is:agent search query` - Alternative syntax (GitHub-style)
 *
 * @param query - The raw search query
 * @returns Parsed query with type filter and cleaned query string
 *
 * @example
 * parseSearchQuery('type:agent my search')
 * // => { cleanQuery: 'my search', typeFilter: 'agent' }
 *
 * @example
 * parseSearchQuery('is:message hello')
 * // => { cleanQuery: 'hello', typeFilter: 'message' }
 *
 * @example
 * parseSearchQuery('regular search')
 * // => { cleanQuery: 'regular search', typeFilter: undefined }
 */
export function parseSearchQuery(query: string): ParsedQuery {
  if (!query || typeof query !== 'string') {
    return { cleanQuery: '' };
  }

  let cleanQuery = query.trim();
  let typeFilter: ValidSearchType | undefined;

  // Match type:xxx or is:xxx patterns
  const typePattern = /(?:^|\s)(type|is):(\w+)(?:\s|$)/i;
  const match = cleanQuery.match(typePattern);

  if (match) {
    const [fullMatch, , typeValue] = match;
    const normalizedType = typeValue.toLowerCase();

    // Validate type
    if (VALID_TYPES.includes(normalizedType as ValidSearchType)) {
      typeFilter = normalizedType as ValidSearchType;
      // Remove the type filter from the query
      cleanQuery = cleanQuery.replace(fullMatch, ' ').trim();
    }
  }

  return {
    cleanQuery,
    typeFilter,
  };
}

/**
 * Build a search query string with a type filter
 *
 * @param query - The search query
 * @param type - The type filter to apply
 * @returns Query string with type filter
 *
 * @example
 * buildQueryWithType('my search', 'agent')
 * // => 'type:agent my search'
 */
export function buildQueryWithType(query: string, type: ValidSearchType): string {
  const cleanQuery = query.trim();
  return cleanQuery ? `type:${type} ${cleanQuery}` : `type:${type}`;
}

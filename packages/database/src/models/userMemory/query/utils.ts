export const normalizeUserMemorySearchQueries = (queries?: string[]): string[] => {
  if (!queries) return [];

  return [...new Set(queries.map((query) => query.trim()).filter(Boolean))];
};

export const buildRetrievalQuery = (queries: string[]) => {
  if (queries.length === 0) return undefined;

  return queries.join(' ');
};

/**
 * Long conversation context is useful to embeddings but not to conjunction-based lexical search:
 * requiring hundreds of analyzed terms to match one field produces no meaningful candidates.
 */
export const USER_MEMORY_LEXICAL_QUERY_CHARACTER_LIMIT = 256;

export const combineEmbeddings = (embeddings: number[][]) => {
  if (embeddings.length === 0) return undefined;
  if (embeddings.length === 1) return embeddings[0];

  const [firstEmbedding] = embeddings;
  if (!firstEmbedding || firstEmbedding.length === 0) return undefined;

  return firstEmbedding.map((_, index) => {
    const sum = embeddings.reduce(
      (accumulator, embedding) => accumulator + (embedding[index] ?? 0),
      0,
    );

    return sum / embeddings.length;
  });
};

export const shouldRunUserMemoryLexicalSearch = (queries: string[], embeddings: number[][]) => {
  const retrievalQuery = buildRetrievalQuery(queries);
  if (!retrievalQuery || !combineEmbeddings(embeddings)) return true;

  return Array.from(retrievalQuery).length <= USER_MEMORY_LEXICAL_QUERY_CHARACTER_LIMIT;
};

export const coerceDate = (input: unknown): Date | null => {
  if (input === null || input === undefined) return null;
  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? null : input;
  }
  if (typeof input === 'string' || typeof input === 'number') {
    const date = new Date(input);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
};

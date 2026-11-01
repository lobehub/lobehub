import type { FtsSearchBackendItem, FtsSearchBackendResponse } from '../types';

/** Map BM25 scores to the relevance scale used by existing search consumers. */
export function mapScoresToRelevance<T extends { score: number }>(
  rows: T[],
): (T & { relevance: number })[] {
  if (rows.length === 0) return [];

  const maxScore = Math.max(...rows.map((row) => row.score));
  return rows.map((row) => ({
    ...row,
    relevance: maxScore > 0 ? 1 + 2 * (1 - row.score / maxScore) : 3,
  }));
}

export function buildResponse<
  T extends { id: string; score: number },
  TItem extends FtsSearchBackendItem,
>(rows: T[], mapItem: (row: T & { relevance: number }) => TItem): FtsSearchBackendResponse<TItem> {
  return buildScoredResponse(mapScoresToRelevance(rows), mapItem);
}

export function buildScoredResponse<
  T extends { id: string; relevance: number; score: number },
  TItem extends FtsSearchBackendItem,
>(rows: T[], mapItem: (row: T) => TItem): FtsSearchBackendResponse<TItem> {
  return {
    candidates: rows.map((row) => ({ id: row.id, score: row.score })),
    items: rows.map(mapItem),
  };
}

export function buildSelectedResponse<
  T extends { id: string; relevance: number; score: number },
  TItem extends FtsSearchBackendItem,
>(candidates: T[], rows: T[], mapItem: (row: T) => TItem): FtsSearchBackendResponse<TItem> {
  return {
    candidates: candidates.map((row) => ({ id: row.id, score: row.score })),
    items: rows.map(mapItem),
  };
}

/** Truncate optional search snippets while preserving the old empty-value behavior. */
export function truncate(
  content: string | null | undefined,
  maxLength: number = 200,
): string | null {
  if (!content) return null;
  if (content.length <= maxLength) return content;
  return content.slice(0, maxLength) + '...';
}

/**
 * Neon (and some managed Postgres) no longer allow ParadeDB `pg_search`.
 * BM25 index migrations must be recorded as applied without executing when
 * the extension is unavailable — same idea as packages/database getTestDB.
 */

export const migrationUsesPgSearchOrBm25 = (sqlStatements: string[]): boolean =>
  sqlStatements.some((statement) => {
    const lower = statement.toLowerCase();
    return lower.includes('pg_search') || lower.includes('bm25');
  });

export const isPgSearchUnavailableError = (error: unknown): boolean => {
  const parts: string[] = [];
  if (error instanceof Error) parts.push(error.message);
  const cause = (error as { cause?: unknown })?.cause;
  if (cause instanceof Error) parts.push(cause.message);
  else if (typeof cause === 'string') parts.push(cause);

  const combined = parts.join(' ').toLowerCase();
  if (!combined.includes('pg_search')) return false;

  return (
    combined.includes('deprecated') ||
    combined.includes('not available') ||
    combined.includes('not allowed') ||
    combined.includes('could not open') ||
    combined.includes('does not exist') ||
    combined.includes('is not available')
  );
};

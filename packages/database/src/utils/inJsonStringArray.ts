import type { SQL, SQLWrapper } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

/**
 * Match a text column against an arbitrary-size ID set using one JSONB bind parameter.
 * Candidate-only search can be unbounded, so expanding every ID through `inArray`
 * would exceed PostgreSQL's bind-parameter limit for large histories.
 */
export const inJsonStringArray = (column: SQLWrapper, values: string[]): SQL<boolean> => {
  if (values.length === 0) return sql<boolean>`false`;

  return sql<boolean>`${column} IN (
    SELECT value
    FROM jsonb_array_elements_text(${JSON.stringify(values)}::jsonb) AS candidate_ids(value)
  )`;
};

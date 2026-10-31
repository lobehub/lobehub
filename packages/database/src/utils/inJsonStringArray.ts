import type { SQL, SQLWrapper } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

/**
 * Match a text column against an arbitrary-size ID set using one JSONB bind parameter.
 * Candidate-only search can be unbounded, so expanding every ID through `inArray`
 * would exceed PostgreSQL's bind-parameter limit for large histories.
 *
 * The set is folded into an array (`= ANY(ARRAY(...))`) rather than joined as
 * `IN (SELECT ...)`: the planner estimates any set-returning function at 100
 * rows, so as a semi-join it preferred scanning the caller's whole history by
 * `user_id` and filtering by ID last — minutes for a user with ~1.7M messages.
 * As an array the candidates drive a primary-key index scan instead.
 */
export const inJsonStringArray = (column: SQLWrapper, values: string[]): SQL<boolean> => {
  if (values.length === 0) return sql<boolean>`false`;

  return sql<boolean>`${column} = ANY(ARRAY(
    SELECT value
    FROM jsonb_array_elements_text(${JSON.stringify(values)}::jsonb) AS candidate_ids(value)
  ))`;
};

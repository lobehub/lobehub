/**
 * Accessors for values the schema or the SQL guarantees but drizzle's inferred
 * types still mark as possibly missing: the single row of an ungrouped
 * `count()`, a NOT NULL value read through a nullable column type, or a column
 * the WHERE clause already filters to non-NULL.
 *
 * They throw instead of falling back to `0`, `null`, or `[]`, so a broken
 * guarantee surfaces as an error rather than a silently wrong answer.
 */

/** Returns `value`, or throws when the guarantee named by `context` does not hold. */
export const nonNull = <T>(value: T | null | undefined, context: string): T => {
  if (value === null || value === undefined) {
    throw new Error(`Expected a value for ${context}, got ${String(value)}`);
  }
  return value;
};

/** Returns the row a query must yield, or throws when it is missing. */
export const firstRow = <T>(rows: readonly T[], context: string): T =>
  nonNull(rows[0], `the first row of ${context}`);

/**
 * Reads the `count` column of an ungrouped `count()` query, which always
 * returns exactly one row. Accepts `count(*)` read as text (`sql<number>`
 * without a cast arrives as a string from node-postgres).
 */
export const countOf = (rows: readonly { count: number | string }[], context: string): number =>
  Number(firstRow(rows, context).count);

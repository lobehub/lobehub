import type { SQL, SQLWrapper } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

/** Escape LIKE/ILIKE metacharacters (`\ % _`) so user input matches literally. */
export const escapeLike = (value: string): string =>
  value.replaceAll(/[\\%_]/g, (character) => `\\${character}`);

/**
 * Case-insensitive substring predicate with an explicit escape character, so the
 * behavior does not depend on the session's `standard_conforming_strings` setting.
 */
export const ilikeContains = (column: SQLWrapper, needle: string): SQL<boolean> =>
  sql<boolean>`${column} ILIKE ${`%${escapeLike(needle)}%`} ESCAPE '\\'`;

import type { SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

/** One searchable PostgreSQL field expression together with its ranking weight. */
export interface PostgresFtsSearchField {
  column: AnyPgColumn | SQL;
  /** Cast JSONB fields to text for providers that cannot match JSONB natively. */
  jsonb?: boolean;
  /** Relative ranking weight for providers that synthesize scores; defaults to 1. */
  weight?: number;
}

/** Provider-specific SQL fragments consumed by the shared PostgreSQL query layer. */
export interface PostgresFtsSearchDialect {
  /** Whether ranking relies on an isolated single-table scored scan. */
  isolatesScoredScan: boolean;
  /** Provider identity reported through backend measurements. */
  key: string;
  /** Row qualifies when at least one field matches the whole prepared query. */
  match: (fields: PostgresFtsSearchField[], preparedQuery: string) => SQL;
  /** Normalize raw user text once per request; throws when nothing searchable remains. */
  prepare: (query: string) => string;
  /** Ranking expression where a higher value is more relevant. */
  score: (
    keyColumn: AnyPgColumn,
    fields: PostgresFtsSearchField[],
    preparedQuery: string,
  ) => SQL<number>;
}

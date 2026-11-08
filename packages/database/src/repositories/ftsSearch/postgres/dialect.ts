import type { SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

/** The one database capability partial matching needs, to run the provider's tokenizer. */
export interface PostgresFtsSearchPartialDb {
  execute: (query: SQL) => Promise<unknown>;
}

/** One searchable PostgreSQL field expression together with its ranking weight. */
export interface PostgresFtsSearchField {
  column: AnyPgColumn | SQL;
  /** Cast JSONB fields to text for providers that cannot match JSONB natively. */
  jsonb?: boolean;
  /** Relative ranking weight for providers that synthesize scores; defaults to 1. */
  weight?: number;
}

/** Match and ranking expressions for a query where only some terms must be present. */
export interface PostgresFtsSearchPartialQuery {
  match: SQL;
  score: SQL<number>;
}

export const POSTGRES_PARTIAL_MATCH_MAX_TERMS = 48;

/** A partial match always needs two terms, or one common word would qualify a document. */
export const minimumTermMatches = (termCount: number, ratio: number) =>
  Math.max(Math.min(2, termCount), Math.ceil(termCount * ratio));

/** Provider-specific SQL fragments consumed by the shared PostgreSQL query layer. */
export interface PostgresFtsSearchDialect {
  /** Whether ranking relies on an isolated single-table scored scan. */
  isolatesScoredScan: boolean;
  /** Provider identity reported through backend measurements. */
  key: string;
  /** Row qualifies when at least one field matches the whole prepared query. */
  match: (fields: PostgresFtsSearchField[], preparedQuery: string) => SQL;
  /**
   * Build a query matching rows that contain at least `ratio` of the terms, or `undefined` when
   * the query has too few terms for that to differ from the strict match.
   */
  partial: (
    db: PostgresFtsSearchPartialDb,
    keyColumn: AnyPgColumn,
    fields: PostgresFtsSearchField[],
    query: string,
    ratio: number,
  ) => Promise<PostgresFtsSearchPartialQuery | undefined>;
  /** Normalize raw user text once per request; throws when nothing searchable remains. */
  prepare: (query: string) => string;
  /** Ranking expression where a higher value is more relevant. */
  score: (
    keyColumn: AnyPgColumn,
    fields: PostgresFtsSearchField[],
    preparedQuery: string,
  ) => SQL<number>;
}

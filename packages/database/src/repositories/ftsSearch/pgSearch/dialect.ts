import type { SQL } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import { sanitizeBm25Query } from '../../../utils/bm25';
import { escapeLike } from '../../../utils/like';

/** One searchable column of a single table together with its ranking weight. */
export interface PgFtsSearchField {
  column: AnyPgColumn;
  /**
   * `jsonb` columns are indexed natively by BM25 but must be cast to text before a
   * substring provider can match them.
   */
  jsonb?: boolean;
  /** Relative ranking weight for providers that synthesize scores; defaults to 1. */
  weight?: number;
}

/**
 * Provider-specific SQL fragments shared by every PostgreSQL-backed search query.
 *
 * The query modules under `pgSearch/` own permission scoping, exclusions, joins,
 * pagination, and result mapping. Only the match predicate, the score expression,
 * and the query preparation differ between PostgreSQL providers, so those are the
 * whole dialect surface.
 */
export interface PgFtsSearchDialect {
  /**
   * Whether ranking relies on an isolated single-table scored scan. ParadeDB only
   * uses its TopN custom scan when the scan node carries the whole
   * `ORDER BY score LIMIT n`, so non-indexed filters are lifted above it and the
   * candidate pool is deepened to compensate. Plain PostgreSQL providers keep every
   * filter inline and return exact results.
   */
  isolatesScoredScan: boolean;
  /** Provider identity reported through backend measurements. */
  key: string;
  /** Row qualifies when at least one field matches the whole prepared query. */
  match: (fields: PgFtsSearchField[], preparedQuery: string) => SQL;
  /** Normalize raw user text once per request; throws when nothing searchable remains. */
  prepare: (query: string) => string;
  /** Ranking expression where a higher value is more relevant. */
  score: (keyColumn: AnyPgColumn, fields: PgFtsSearchField[], preparedQuery: string) => SQL<number>;
}

/** ParadeDB `pg_search`: BM25 match operator and index-backed scores. */
export const pgSearchDialect: PgFtsSearchDialect = {
  isolatesScoredScan: true,
  key: 'pg_search',
  match: (fields, preparedQuery) =>
    sql`(${sql.join(
      fields.map((field) => sql`${field.column} @@@ ${preparedQuery}`),
      sql` OR `,
    )})`,
  prepare: (query) => sanitizeBm25Query(query),
  score: (keyColumn) => sql<number>`paradedb.score(${keyColumn})`,
};

const LIKE_ESCAPE = sql.raw(`ESCAPE '\\'`);

/**
 * Mirrors the BM25 sanitizer's tokenization (hyphens act as separators) so a
 * hyphenated query still matches text written with spaces. A query made only of
 * separators falls back to one literal term.
 */
const splitLikeTerms = (query: string) => {
  const trimmed = query.trim();
  const terms = trimmed.replaceAll('-', ' ').split(/\s+/).filter(Boolean);

  return terms.length > 0 ? terms : [trimmed];
};

const likeTextExpression = (field: PgFtsSearchField): SQL =>
  field.jsonb ? sql`${field.column}::text` : sql`${field.column}`;

/** Every term must appear somewhere in the same field, mirroring the BM25 `AND` join. */
const likeAllTerms = (field: PgFtsSearchField, terms: string[]): SQL =>
  sql`(${sql.join(
    terms.map(
      (term) => sql`${likeTextExpression(field)} ILIKE ${`%${escapeLike(term)}%`} ${LIKE_ESCAPE}`,
    ),
    sql` AND `,
  )})`;

/**
 * Plain PostgreSQL `ILIKE` substring matching for deployments without any search
 * extension or external service. Substring matching needs no tokenizer, so CJK
 * text works without application-side segmentation, and no index or migration is
 * required.
 *
 * Scores are synthesized per field from the strongest match kind (whole-field,
 * prefix, phrase substring, or all terms present) multiplied by the field weight,
 * so the existing relevance normalization keeps title hits ahead of body hits.
 */
export const pgLikeDialect: PgFtsSearchDialect = {
  isolatesScoredScan: false,
  key: 'pg_like',
  match: (fields, preparedQuery) => {
    const terms = splitLikeTerms(preparedQuery);

    return sql`(${sql.join(
      fields.map((field) => likeAllTerms(field, terms)),
      sql` OR `,
    )})`;
  },
  prepare: (query) => {
    const prepared = query.trim();
    if (!prepared) throw new Error('Query is empty after sanitization');

    return prepared;
  },
  score: (_keyColumn, fields, preparedQuery) => {
    const phrase = escapeLike(preparedQuery);
    const terms = splitLikeTerms(preparedQuery);

    return sql<number>`(${sql.join(
      fields.map((field) => {
        const text = likeTextExpression(field);
        const weight = field.weight ?? 1;
        const weighted = (multiplier: number) => sql.raw(String(weight * multiplier));

        return sql`(CASE WHEN ${text} ILIKE ${phrase} ${LIKE_ESCAPE} THEN ${weighted(4)} WHEN ${text} ILIKE ${`${phrase}%`} ${LIKE_ESCAPE} THEN ${weighted(3)} WHEN ${text} ILIKE ${`%${phrase}%`} ${LIKE_ESCAPE} THEN ${weighted(2)} WHEN ${likeAllTerms(field, terms)} THEN ${weighted(1)} ELSE 0 END)`;
      }),
      sql` + `,
    )})`;
  },
};

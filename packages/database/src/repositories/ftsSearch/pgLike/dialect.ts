import { sql } from 'drizzle-orm';

import { SAFE_BM25_QUERY_OPTIONS } from '../../../utils/bm25';
import { escapeLike } from '../../../utils/like';
import type { PostgresFtsSearchDialect, PostgresFtsSearchField } from '../postgres/dialect';

const LIKE_ESCAPE = sql.raw(`ESCAPE '\\'`);
const LIKE_MAX_TERMS = SAFE_BM25_QUERY_OPTIONS.maxTerms;

const splitLikeTerms = (query: string) => {
  const trimmed = query.trim();
  const terms = trimmed.replaceAll('-', ' ').split(/\s+/).filter(Boolean).slice(0, LIKE_MAX_TERMS);

  return terms.length > 0 ? terms : [trimmed];
};

const likeTextExpression = (field: PostgresFtsSearchField) =>
  field.jsonb ? sql`${field.column}::text` : sql`${field.column}`;

/** Every term must appear somewhere in the same field. */
const likeAllTerms = (field: PostgresFtsSearchField, terms: string[]) =>
  sql`(${sql.join(
    terms.map(
      (term) => sql`${likeTextExpression(field)} ILIKE ${`%${escapeLike(term)}%`} ${LIKE_ESCAPE}`,
    ),
    sql` AND `,
  )})`;

/** Plain PostgreSQL substring matching without an extension or external service. */
export const pgLikeDialect: PostgresFtsSearchDialect = {
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

import { Column, is, sql } from 'drizzle-orm';

import { sanitizeBm25Query } from '../../../utils/bm25';
import type { PostgresFtsSearchDialect, PostgresFtsSearchField } from '../postgres/dialect';
import { minimumTermMatches, POSTGRES_PARTIAL_MATCH_MAX_TERMS } from '../postgres/dialect';

const indexedFieldName = (field: PostgresFtsSearchField) => {
  if (!is(field.column, Column)) throw new Error('pg_search partial match needs indexed columns');

  return field.column.name;
};

/** Split with the analyzer the documents were indexed with, so terms line up with the index. */
const tokenize = async (
  db: Parameters<PostgresFtsSearchDialect['partial']>[0],
  query: string,
): Promise<string[]> => {
  const result = (await db.execute(
    sql`SELECT token FROM paradedb.tokenize(paradedb.tokenizer('icu'), ${query})`,
  )) as { rows: { token: string }[] };

  return [...new Set(result.rows.map(({ token }) => token.toLowerCase()))].slice(
    0,
    POSTGRES_PARTIAL_MATCH_MAX_TERMS,
  );
};

/** ParadeDB `pg_search`: BM25 match operator and index-backed scores. */
export const pgSearchDialect: PostgresFtsSearchDialect = {
  isolatesScoredScan: true,
  key: 'pg_search',
  match: (fields, preparedQuery) =>
    sql`(${sql.join(
      fields.map((field) => sql`${field.column} @@@ ${preparedQuery}`),
      sql` OR `,
    )})`,
  partial: async (db, keyColumn, fields, query, ratio) => {
    const terms = await tokenize(db, query);
    if (terms.length < 2) return undefined;

    const termClauses = terms.map(
      (term) =>
        sql`paradedb.boolean(should => ARRAY[${sql.join(
          fields.map(
            (field) =>
              sql`paradedb.match(${sql.raw(`'${indexedFieldName(field)}'`)}, ${term}::text)`,
          ),
          sql`, `,
        )}])`,
    );

    return {
      match: sql`${keyColumn} @@@ paradedb.boolean(should => ARRAY[${sql.join(termClauses, sql`, `)}], minimum_should_match => ${sql.raw(String(minimumTermMatches(terms.length, ratio)))})`,
      score: sql<number>`paradedb.score(${keyColumn})`,
    };
  },
  prepare: (query) => sanitizeBm25Query(query),
  score: (keyColumn) => sql<number>`paradedb.score(${keyColumn})`,
};

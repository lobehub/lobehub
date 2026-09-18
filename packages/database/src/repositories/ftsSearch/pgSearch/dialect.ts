import { sql } from 'drizzle-orm';

import { sanitizeBm25Query } from '../../../utils/bm25';
import type { PostgresFtsSearchDialect } from '../postgres/dialect';

/** ParadeDB `pg_search`: BM25 match operator and index-backed scores. */
export const pgSearchDialect: PostgresFtsSearchDialect = {
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

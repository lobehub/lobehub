import { type SQL, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

// Keep token encoding and the final name tie-breaker in sync with toNaturalSortKey.
export const naturalNameKey = (name: SQL | AnyPgColumn) =>
  sql<string>`(
    COALESCE(
      (
        SELECT string_agg(
          CASE
            WHEN token[1] ~ '^[0-9]+$' THEN
              CASE
                WHEN LENGTH(COALESCE(NULLIF(LTRIM(token[1], '0'), ''), '0')) <= 20
                  THEN LPAD(COALESCE(NULLIF(LTRIM(token[1], '0'), ''), '0'), 20, '0')
                ELSE '99999999999999999999:'
                  || LPAD(LENGTH(COALESCE(NULLIF(LTRIM(token[1], '0'), ''), '0'))::text, 10, '0')
                  || ':'
                  || COALESCE(NULLIF(LTRIM(token[1], '0'), ''), '0')
              END
            ELSE token[1]
          END,
          '' ORDER BY ord
        )
        FROM regexp_matches(LOWER(${name}), '[0-9]+|[^0-9]+', 'g') WITH ORDINALITY AS t(token, ord)
      ),
      ''
    ) || chr(1) || LOWER(${name})
  ) COLLATE "C"`.as('natural_name_key');

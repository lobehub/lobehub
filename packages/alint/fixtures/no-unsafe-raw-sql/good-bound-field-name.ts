// ParadeDB's `paradedb.match(field, value)` takes the field NAME as a text argument,
// so binding it through the Drizzle `sql` template is correct and cannot change syntax.
import type { AnyColumn, SQL } from 'drizzle-orm';
import { or, sql } from 'drizzle-orm';

export const buildBm25Condition = (params: {
  groups: { fields: string[]; keyColumn: AnyColumn }[];
  matchQuery: string;
}) => {
  const conditions = params.groups
    .map(({ fields, keyColumn }) => {
      if (fields.length === 0) return undefined;

      const matches = fields.map(
        (field) => sql`paradedb.match(${field}, ${params.matchQuery}, conjunction_mode => true)`,
      );

      return sql<boolean>`${keyColumn} @@@ paradedb.boolean(should => ARRAY[${sql.join(matches, sql`, `)}])`;
    })
    .filter((condition): condition is SQL<boolean> => Boolean(condition));

  return conditions.length > 0 ? or(...conditions) : undefined;
};

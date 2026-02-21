import { getTableColumns } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';

export const selectNonVectorColumns = <T extends PgTable>(
  table: T,
): {
  [K in keyof T['_']['columns'] as K extends `${string}Vector`
    ? never
    : K extends `${string}Vector${number}`
      ? never
      : K]: T['_']['columns'][K];
} => {
  const columns = getTableColumns(table);
  const selection: Record<string, unknown> = {};

  for (const [key, column] of Object.entries(columns)) {
    if (column.getSQLType().toLowerCase().startsWith('vector')) {
      continue;
    }

    selection[key] = column;
  }

  return selection as any;
};

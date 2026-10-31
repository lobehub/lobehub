// Fixture: generic helpers over any table and table-object types are not row inference.
import type { InferSelectModel, SQL } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';

import type { tasks, userMemories } from '@/database/schemas';

export const firstRow = async <T extends PgTable>(
  rows: Promise<InferSelectModel<T>[]>,
): Promise<InferSelectModel<T> | undefined> => (await rows)[0];

export const pickInsertable = <TTable extends PgTable>(
  value: Partial<TTable['$inferInsert']>,
): Partial<TTable['$inferInsert']> => value;

export const scopedTo = (table: typeof userMemories | typeof tasks, where: SQL) => ({
  table,
  where,
});

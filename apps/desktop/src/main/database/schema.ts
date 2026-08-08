import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const localRecords = sqliteTable('local_records', {
  id: text('id').primaryKey().notNull(),
  value: text('value').notNull(),
});

export const localDatabaseSchema = { localRecords };

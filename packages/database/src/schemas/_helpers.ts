import { numeric, timestamp, varchar } from 'drizzle-orm/pg-core';

export const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

export const varchar255 = (name: string) => varchar(name, { length: 255 });

export const createdAt = () => timestamptz('created_at').notNull().defaultNow();
export const updatedAt = () =>
  timestamptz('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
export const accessedAt = () =>
  timestamptz('accessed_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/**
 * Amount field - Unified configuration with precision 20, scale 6, returns number type
 *
 * Caller should handle default and nullable values
 */
export const amountNumeric = (name: string) =>
  numeric(name, { mode: 'number', precision: 20, scale: 6 });

// columns.helpers.ts
export const timestamps = {
  accessedAt: accessedAt(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
};

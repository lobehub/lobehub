import { boolean, numeric, timestamp, varchar } from 'drizzle-orm/pg-core';

export const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

export const varchar255 = (name: string) => varchar(name, { length: 255 });

export const createdAt = () => timestamptz('created_at').notNull().defaultNow();
export const updatedAt = () =>
  timestamptz('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
/**
 * Soft-delete columns for user content that goes through the recycle bin.
 *
 * - `isDeleted` — set to `true` when the row is trashed, and only then. A live
 *   row leaves it NULL rather than carrying an explicit `false`, so the column
 *   costs nothing on the overwhelming majority of rows and the flag reads as
 *   "this row was deleted" instead of "this row has a deletion state".
 * - `deletedAt` — when the row was trashed; drives the retention clock and
 *   the "deleted 3 days ago" copy.
 *
 * The two are always written together (`trashStamp()` / `restoreStamp()` in
 * `utils/softDelete.ts`) — treat `is_deleted IS TRUE` and
 * `deleted_at IS NOT NULL` as equivalent.
 *
 * **Reads must test `is_deleted IS NOT TRUE`, never `= false`.** NULL is the
 * live state, and `is_deleted = false` is NULL — hence not true — for every
 * live row, so an equality filter silently returns nothing. See
 * `utils/workspace.ts` for the read-side funnel and `schemas/trash.ts` for the
 * registry that indexes trashed roots across tables.
 *
 * Adding this to a table makes its rows *filterable*; it does not make them
 * *trashable* — that still needs a handler in the server `TrashService`.
 */
export const softDeleteColumns = () => ({
  deletedAt: timestamptz('deleted_at'),
  isDeleted: boolean('is_deleted'),
});

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

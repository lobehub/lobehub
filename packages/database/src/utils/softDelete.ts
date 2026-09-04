import { eq, type SQL, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

/**
 * Predicate every ownership-scoped read of a recycle-bin-aware table must
 * carry: `is_deleted IS NOT TRUE`.
 *
 * It is `IS NOT TRUE` and not `= false` because a live row leaves `is_deleted`
 * NULL — only a trashed row is stamped (see `softDeleteColumns()` in
 * `schemas/_helpers.ts`). `is_deleted = false` evaluates to NULL for those
 * rows, which is not true, so an equality filter would hide the entire table
 * instead of just its trashed rows. `IS NOT TRUE` is also correct for a row
 * explicitly stamped `false`, so it holds whichever way the column is written.
 *
 * Kept as a named helper (rather than an inline predicate) so the call sites
 * are greppable when auditing which reads still see trashed rows.
 * `buildWorkspaceWhere` applies it automatically for tables in
 * `TRASH_AWARE_TABLES`; use this only where that funnel is bypassed.
 */
export const notTrashed = (isDeleted: AnyPgColumn): SQL => sql`${isDeleted} IS NOT TRUE`;

/** Inverse of {@link notTrashed}: rows sitting in the recycle bin. */
export const isTrashed = (isDeleted: AnyPgColumn): SQL => eq(isDeleted, true);

/**
 * The write half of the `is_deleted IS TRUE ⟺ deleted_at IS NOT NULL`
 * invariant. Every soft delete sets both columns from one stamp …
 */
export const trashStamp = (deletedAt: Date) => ({ deletedAt, isDeleted: true }) as const;

/**
 * … and every restore clears both back to NULL — the live state — so a
 * restored row is indistinguishable from one that was never trashed.
 */
export const restoreStamp = () => ({ deletedAt: null, isDeleted: null }) as const;

/** Options shared by every model-level `softDelete*` primitive. */
export interface SoftDeleteOptions {
  /** Trash-time instant shared across a cascade so children carry the root's stamp. */
  deletedAt: Date;
  /**
   * Workspace non-owner members may only sweep their own rows (mirrors the
   * `restrictToCreator` convention of the hard-delete paths).
   */
  restrictToCreator?: boolean;
}

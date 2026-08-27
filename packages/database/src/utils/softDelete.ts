import { eq, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

/**
 * Predicate every ownership-scoped read of a recycle-bin-aware table must
 * carry: `is_deleted = false`. Kept as a named helper (rather than an inline
 * `eq`) so the call sites are greppable when auditing which reads still see
 * trashed rows. `buildWorkspaceWhere` applies it automatically for tables in
 * `TRASH_AWARE_TABLES`; use this only where that funnel is bypassed.
 */
export const notTrashed = (isDeleted: AnyPgColumn): SQL => eq(isDeleted, false);

/** Inverse of {@link notTrashed}: rows sitting in the recycle bin. */
export const isTrashed = (isDeleted: AnyPgColumn): SQL => eq(isDeleted, true);

/**
 * The write half of the `is_deleted = (deleted_at IS NOT NULL)` invariant.
 * Every soft delete sets both columns from one stamp …
 */
export const trashStamp = (deletedAt: Date) => ({ deletedAt, isDeleted: true }) as const;

/** … and every restore clears both. */
export const restoreStamp = () => ({ deletedAt: null, isDeleted: false }) as const;

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

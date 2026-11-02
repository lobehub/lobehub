import { isNull, notInArray, or, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

/**
 * Memories readers see, by lifecycle state: unset (rows that predate the lifecycle), hypothesis
 * and active. Consolidation marks a legacy per-topic context `superseded` once it lives on as an
 * evidence activity; `rejected` is a memory the user or the pipeline turned down.
 */
export const visibleMemoryState = (state: AnyPgColumn): SQL =>
  or(isNull(state), notInArray(state, ['superseded', 'rejected'])) as SQL;

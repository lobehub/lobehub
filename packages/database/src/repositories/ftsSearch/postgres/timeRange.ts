import type { SQL } from 'drizzle-orm';
import { and, gte, lte } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import type { FtsSearchTimeRange } from '../types';

/**
 * Time-window predicate for conversation and page retrieval. Pools are cut by
 * score before hydration, so the window must narrow the scan itself; applying
 * it afterwards lets out-of-window hits exhaust the pool.
 */
export const timeRangeWhere = (
  table: { createdAt: AnyPgColumn; updatedAt: AnyPgColumn },
  range?: FtsSearchTimeRange,
): SQL | undefined => {
  if (!range || (!range.start && !range.end)) return;
  const column = range.field === 'createdAt' ? table.createdAt : table.updatedAt;

  return and(
    range.start ? gte(column, range.start) : undefined,
    range.end ? lte(column, range.end) : undefined,
  );
};

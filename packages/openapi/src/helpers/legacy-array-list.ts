import { z } from 'zod';

import { buildPageInfo, CursorPaginationQuerySchema, resolvePagination } from './pagination';

/**
 * Query of a list that used to answer a bare array (agent groups, API keys,
 * MCP servers). It now answers the paginated `{ items, total, hasMore,
 * nextCursor }` object; `format=array` restores the old bare array of every
 * item for clients written before the change.
 */
export const LegacyArrayListQuerySchema = CursorPaginationQuerySchema.extend({
  format: z.enum(['array']).optional().meta({
    deprecated: true,
    description:
      'Deprecated: `array` returns the pre-pagination bare array of every item instead of the paginated object. Migrate to `items` + `nextCursor`.',
  }),
});

export type LegacyArrayListQuery = z.infer<typeof LegacyArrayListQuerySchema>;

/** Route description shared by the three former bare-array lists. */
export const LEGACY_ARRAY_LIST_DESCRIPTION =
  'Paginated with `limit` + `cursor`; answers `{ items, total, hasMore, nextCursor }`. Clients that still expect the former bare array can pass the deprecated `format=array`, which returns every item as a plain array.';

/**
 * Page an already-loaded list in memory, or hand back the whole array for
 * `format=array`.
 */
export const pageLoadedList = <T>(all: T[], query: LegacyArrayListQuery = {}) => {
  if (query.format === 'array') return all;

  const window = resolvePagination(query);
  const items = all.slice(window.offset, window.offset + window.limit);
  return {
    items,
    total: all.length,
    ...buildPageInfo({ ...window, returned: items.length, total: all.length }),
  };
};

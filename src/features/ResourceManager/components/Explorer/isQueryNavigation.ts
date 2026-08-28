import type { ResourceQueryParams } from '@/types/resource';

/**
 * Query fields that select a different *pool* of resources rather than a
 * different arrangement of the same one. Changing any of them is a navigation:
 * the rows on screen stop being an answer to the question now being asked, so
 * the views show a skeleton instead of the stale list.
 *
 * `sorter` / `sortType` are deliberately absent — they reorder the same pool
 * and re-sort locally, so a skeleton there would be a flash for nothing.
 */
const POOL_KEYS = [
  'libraryId',
  'parentId',
  'category',
  'visibility',
  'sourceFilter',
] as const satisfies readonly (keyof ResourceQueryParams)[];

/**
 * Whether the explorer is moving between two different resource pools.
 *
 * Both the list and the masonry view need this, and they used to carry their
 * own copies of the comparison — which is exactly how `sourceFilter` came to be
 * missing from both at once. Keep it here so a new pool-selecting field is
 * added in one place.
 */
export const isQueryNavigation = (
  current: ResourceQueryParams | undefined,
  next: ResourceQueryParams | undefined,
): boolean => {
  if (!current || !next) return false;

  return POOL_KEYS.some((key) => current[key] !== next[key]);
};

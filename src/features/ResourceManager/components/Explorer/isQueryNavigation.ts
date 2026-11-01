import { RESOURCE_POOL_KEYS } from '@/store/file/slices/resource/utils';
import type { ResourceQueryParams } from '@/types/resource';

/**
 * Whether the explorer is moving between two different resource pools.
 *
 * Both the list and the masonry view need this, and they used to carry their
 * own copies of the comparison — which is exactly how `sourceFilter` came to be
 * missing from both at once. The key list lives with the replica (which resets
 * its rows on the same signal) so a new pool-selecting field is added in one
 * place and both the skeleton and the hydration agree on it.
 */
export const isQueryNavigation = (
  current: ResourceQueryParams | undefined,
  next: ResourceQueryParams | undefined,
): boolean => {
  if (!current || !next) return false;

  return RESOURCE_POOL_KEYS.some((key) => current[key] !== next[key]);
};

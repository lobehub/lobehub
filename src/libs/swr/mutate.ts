/**
 * Scoped SWR Mutate
 *
 * When using a custom cache provider with SWRConfig, the global `mutate` from 'swr'
 * becomes a no-op because it can't access the scoped cache.
 *
 * This module stores the scoped mutate function from SWRConfig for use outside React components.
 * The mutate function is initialized when the SWRConfig component mounts.
 *
 * @see https://github.com/vercel/swr/issues/2799
 *
 * @example
 * ```ts
 * // Instead of:
 * import { mutate } from 'swr';
 *
 * // Use:
 * import { mutate } from '@/libs/swr';
 * ```
 */
import { type ScopedMutator } from 'swr/_internal';

import { getActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';

import { augmentKey } from './augmentKey';

// Mutable container to hold the scoped mutate reference
// Using an object allows us to update the reference while keeping the same export
const mutateRef: { current: ScopedMutator | null } = { current: null };

/**
 * Set the scoped mutate function from SWRConfig
 * Called internally by SWRProvider on mount
 */
export const setScopedMutate = (m: ScopedMutator) => {
  mutateRef.current = m;
};

/**
 * Get the scoped mutate function
 * Returns the actual mutate function from useSWRConfig(), not a wrapper
 */
export const getMutate = (): ScopedMutator => {
  if (!mutateRef.current) {
    console.warn('[SWR] Scoped mutate not initialized, this may cause cache sync issues');
    // Return a no-op function that returns empty array
    return (() => []) as unknown as ScopedMutator;
  }
  return mutateRef.current;
};

/**
 * Scoped mutate function that works with custom cache providers. Mirrors the
 * `augmentKey` treatment that `useClientDataSWR` applies to subscriber keys so
 * a workspace-scoped revalidation actually matches its subscriber — without
 * this, a `mutate(['x'])` call from a store action would miss every active
 * `useSWR([['x'], wsId])` and silently no-op (manifested as image generation
 * topics not appearing after create, batches not refreshing after submit).
 *
 * - Function-form keys (SWR matcher predicates) are passed through unchanged;
 *   the predicate already controls its own match logic.
 * - Concrete keys go through `augmentKey` with the current active workspace
 *   id, which is a no-op in personal mode.
 *
 * Use this instead of `import { mutate } from 'swr'` when using localStorage
 * cache provider.
 */
export const mutate: ScopedMutator = (async (...args: Parameters<ScopedMutator>) => {
  const [key, ...rest] = args;
  const finalKey = typeof key === 'function' ? key : augmentKey(key, getActiveWorkspaceId());
  return await getMutate()(finalKey as any, ...(rest as [any, any]));
}) as ScopedMutator;

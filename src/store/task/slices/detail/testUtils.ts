import { vi } from 'vitest';

import { cacheScope, replicaKeys } from '@/libs/replica';
import { mutate } from '@/libs/swr';

import { taskDetailResource } from './projection';

/**
 * Revalidations of one task detail's sync, as seen by a test that mocks
 * `@/libs/swr`'s `mutate` (the replica driver revalidates through it).
 */
export const taskDetailRefreshes = (id: string) => {
  const key = replicaKeys.sync(
    taskDetailResource.name,
    taskDetailResource.version,
    cacheScope.get(),
    id,
    id,
  );
  return vi
    .mocked(mutate)
    .mock.calls.filter(([match]) => typeof match === 'function' && (match as any)(key));
};

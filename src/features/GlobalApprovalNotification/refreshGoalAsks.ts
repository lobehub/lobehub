import { revalidateReplica } from '@/libs/replica';
import { mutate } from '@/libs/swr';
import { goalKeys } from '@/libs/swr/keys';
import { briefListResource } from '@/store/brief/slices/list/projection';
import { goalGraphResource } from '@/store/goal/projection';

/**
 * Re-read everything that asks a goal question the owner just answered: the
 * island, the Home inbox (which carries the same gate or sign-off as a brief)
 * and the goal's own graph. The inbox and the graph are replicas, so they are
 * revalidated through their resources — an SWR key prefix no longer reaches them.
 */
export const refreshGoalAsks = (goalId: string) =>
  Promise.all([
    mutate(goalKeys.pendingForIsland()),
    revalidateReplica(briefListResource),
    revalidateReplica(goalGraphResource, goalId),
  ]);

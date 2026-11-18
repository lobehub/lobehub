import { taskService } from '@/services/task';

import type { TaskToPrivatize } from './taskSelectionModel';

/** Visibility changes in flight at once; each one locks and rewrites a subtree. */
const PRIVATIZE_CONCURRENCY = 5;

/**
 * Make each task private (taking over a teammate's task) ahead of a batch
 * assignment to a private agent. A task that cannot go private (edited by
 * someone else, running subtasks, subtasks by other members…) stays public and
 * the batch then reports it as skipped, so failures are counted, not thrown.
 */
export const privatizeTasks = async (
  targets: readonly TaskToPrivatize[],
  update: typeof taskService.updateVisibility = taskService.updateVisibility,
): Promise<{ failed: string[] }> => {
  const failed: string[] = [];
  let next = 0;
  const worker = async () => {
    while (next < targets.length) {
      const target = targets[next++];
      try {
        await (target.takeOwnership
          ? update(target.id, 'private', { takeOwnership: true })
          : update(target.id, 'private'));
      } catch {
        failed.push(target.id);
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(PRIVATIZE_CONCURRENCY, targets.length) }, worker),
  );
  return { failed };
};

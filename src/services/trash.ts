import { TRASH_MUTATION_BATCH_SIZE } from '@lobechat/const';
import type { TrashListParams, TrashResourceType } from '@lobechat/types';
import { chunk } from 'es-toolkit';

import { lambdaClient } from '@/libs/trpc/client';

/**
 * Single chokepoint for the `trash` (recycle bin) TRPC router. Components,
 * hooks and stores call this instead of reaching into `lambdaClient.trash.*`.
 */
class TrashService {
  list(params?: TrashListParams) {
    return lambdaClient.trash.list.query(params ?? undefined);
  }

  countByType() {
    return lambdaClient.trash.countByType.query();
  }

  async restore(ids: string[]) {
    const outcomes = await Promise.all(
      chunk(ids, TRASH_MUTATION_BATCH_SIZE).map((batchIds) =>
        lambdaClient.trash.restore.mutate({ ids: batchIds }),
      ),
    );

    return outcomes.reduce(
      (result, outcome) => ({
        failed: [...result.failed, ...outcome.failed],
        restored: [...result.restored, ...outcome.restored],
      }),
      { failed: [], restored: [] } as (typeof outcomes)[number],
    );
  }

  async purge(ids: string[]) {
    const outcomes = await Promise.all(
      chunk(ids, TRASH_MUTATION_BATCH_SIZE).map((batchIds) =>
        lambdaClient.trash.purge.mutate({ ids: batchIds }),
      ),
    );

    return outcomes.reduce(
      (result, outcome) => ({
        failed: [...result.failed, ...outcome.failed],
        purged: result.purged + outcome.purged,
        purgedIds: [...result.purgedIds, ...outcome.purgedIds],
      }),
      { failed: [], purged: 0, purgedIds: [] } as (typeof outcomes)[number],
    );
  }

  emptyTrash(resourceType?: TrashResourceType) {
    return lambdaClient.trash.emptyTrash.mutate(resourceType ? { resourceType } : undefined);
  }
}

export const trashService = new TrashService();

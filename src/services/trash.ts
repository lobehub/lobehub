import type { ResourceTrashListParams, ResourceTrashType } from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

/**
 * Single chokepoint for the `trash` (recycle bin) TRPC router. Components,
 * hooks and stores call this instead of reaching into `lambdaClient.trash.*`.
 */
class TrashService {
  list(params?: ResourceTrashListParams) {
    return lambdaClient.trash.list.query(params ?? undefined);
  }

  countByType() {
    return lambdaClient.trash.countByType.query();
  }

  async restore(ids: string[]) {
    return lambdaClient.trash.restore.mutate({ ids });
  }

  async purge(ids: string[]) {
    return lambdaClient.trash.purge.mutate({ ids });
  }

  emptyTrash(resourceType?: ResourceTrashType) {
    return lambdaClient.trash.emptyTrash.mutate(resourceType ? { resourceType } : undefined);
  }
}

export const trashService = new TrashService();

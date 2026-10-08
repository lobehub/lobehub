import type { TrashListParams, TrashResourceType } from '@lobechat/types';

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

  restore(ids: string[]) {
    return lambdaClient.trash.restore.mutate({ ids });
  }

  purge(ids: string[]) {
    return lambdaClient.trash.purge.mutate({ ids });
  }

  emptyTrash(resourceType?: TrashResourceType) {
    return lambdaClient.trash.emptyTrash.mutate(resourceType ? { resourceType } : undefined);
  }
}

export const trashService = new TrashService();

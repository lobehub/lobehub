import type { TrashListParams, TrashProjectFilter, TrashResourceType } from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

/** One recycle-bin view: `projectId` undefined = every project, `null` = no project. */
export interface TrashViewFilter {
  projectId?: TrashProjectFilter;
  resourceType?: TrashResourceType;
}

/**
 * Single chokepoint for the `trash` (recycle bin) TRPC router. Components,
 * hooks and stores call this instead of reaching into `lambdaClient.trash.*`.
 */
class TrashService {
  list(params?: Omit<TrashListParams, 'deletedByUserId'>) {
    return lambdaClient.trash.list.query(params ?? undefined);
  }

  countByType(projectId?: TrashProjectFilter) {
    return lambdaClient.trash.countByType.query(
      projectId === undefined ? undefined : { projectId },
    );
  }

  restore(ids: string[]) {
    return lambdaClient.trash.restore.mutate({ ids });
  }

  purge(ids: string[]) {
    return lambdaClient.trash.purge.mutate({ ids });
  }

  /**
   * Purge one bounded batch of the roots `filter` covers. `workspaceId` is the
   * scope the sweep started in (`null` = personal); the server refuses a batch
   * that would run in any other scope.
   */
  emptyTrash(filter: TrashViewFilter, workspaceId: string | null) {
    return lambdaClient.trash.emptyTrash.mutate({ ...filter, workspaceId });
  }
}

export const trashService = new TrashService();

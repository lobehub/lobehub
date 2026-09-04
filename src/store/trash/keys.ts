import type { ResourceTrashType } from '@lobechat/types';

/**
 * Trash stays behind a deferred settings boundary. Keep its cache keys local
 * so loading the recycle bin does not turn the eager central SWR registry into
 * a shared first-screen chunk.
 */
export const trashKeys = {
  countByType: (workspaceId?: string | null) => ['trash:countByType', workspaceId ?? 'personal'],
  list: (workspaceId?: string | null, resourceType?: ResourceTrashType | null) => [
    'trash:list',
    workspaceId ?? 'personal',
    resourceType ?? 'all',
  ],
};

export const trashScopeKey = (workspaceId?: string | null) => workspaceId ?? 'personal';

export const trashBucketKey = (
  workspaceId?: string | null,
  resourceType?: ResourceTrashType | null,
) => `${trashScopeKey(workspaceId)}\0${resourceType ?? 'all'}`;

import { ChannelTrashRepository } from '@/database/repositories/channel/trash';

import { type TrashHandler, TrashPurgeBlockedError, TrashRestoreError } from './types';

/**
 * A Channel thread is its own root, like a message under a topic: its channel must be live
 * before it can come back, and purging the channel takes the thread with it.
 */
export const channelThreadHandler: TrashHandler = {
  purge: async (ctx, root) => {
    const result = await new ChannelTrashRepository(
      ctx.db,
      root.userId,
      root.workspaceId ?? undefined,
    ).purgeThread(root.resourceId);
    if (result === 'busy') throw new TrashPurgeBlockedError('Thread replies are still stopping');
  },
  restore: async (ctx, root) => {
    const result = await new ChannelTrashRepository(
      ctx.db,
      root.userId,
      root.workspaceId ?? undefined,
    ).restoreThread(root.resourceId);
    if (result === 'missing') throw new TrashRestoreError('notFound');
    if (result !== 'restored') throw new TrashRestoreError(result);
  },
  type: 'channelThread',
};

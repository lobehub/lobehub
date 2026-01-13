import type { SharedTopicData } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { TopicShareModel } from '@/database/models/topicShare';
import { publicProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

export const shareRouter = router({
  /**
   * Get shared topic metadata for public access
   * Uses shareId (not topicId) for access
   * Permission check: owner can always access, others depend on accessPermission
   */
  getSharedTopic: publicProcedure
    .use(serverDatabase)
    .input(z.object({ shareId: z.string() }))
    .query(async ({ input, ctx }): Promise<SharedTopicData> => {
      const share = await TopicShareModel.findByShareId(ctx.serverDB, input.shareId);

      if (!share) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Share not found' });
      }

      // Check permission
      const accessCheck = TopicShareModel.checkAccess(share, ctx.userId ?? undefined);
      if (!accessCheck.allowed) {
        if (accessCheck.reason === 'private') {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'This share is private' });
        }
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Sign in required to view this shared topic',
        });
      }

      // Increment view count after permission check passes
      await TopicShareModel.incrementViewCount(ctx.serverDB, input.shareId);

      return {
        accessPermission: share.accessPermission as SharedTopicData['accessPermission'],
        agentId: share.agentId,
        agentMeta: share.agentId
          ? {
              avatar: share.agentAvatar,
              backgroundColor: share.agentBackgroundColor,
              marketIdentifier: share.agentMarketIdentifier,
              title: share.agentTitle,
            }
          : undefined,
        groupId: share.groupId,
        groupMeta: share.groupId
          ? {
              avatar: share.groupAvatar,
              backgroundColor: share.groupBackgroundColor,
              members: share.groupMembers,
              title: share.groupTitle,
            }
          : undefined,
        shareId: share.shareId,
        title: share.title,
        topicId: share.topicId,
      };
    }),
});

export type ShareRouter = typeof shareRouter;

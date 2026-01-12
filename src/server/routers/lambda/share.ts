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

      const isOwner = ctx.userId && share.ownerId === ctx.userId;

      // Check permission (owner can always access)
      if (!isOwner) {
        if (share.accessPermission === 'private') {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'This share is private' });
        }
        if (share.accessPermission === 'public_signin' && !ctx.userId) {
          throw new TRPCError({
            code: 'UNAUTHORIZED',
            message: 'Sign in required to view this shared topic',
          });
        }
      }

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

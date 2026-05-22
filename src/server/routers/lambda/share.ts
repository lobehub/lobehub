import { type SharedTopicData } from '@lobechat/types';
import { z } from 'zod';

import { TopicShareModel } from '@/database/models/topicShare';
import { publicProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

export const shareRouter = router({
  /**
   * Get shared topic metadata for public access
   * Uses shareId (not topicId) for access
   * Visibility check: owner can always access, others depend on visibility setting
   */
  getSharedTopic: publicProcedure
    .use(serverDatabase)
    .input(z.object({ shareId: z.string() }))
    .query(async ({ input, ctx }): Promise<SharedTopicData> => {
      const share = await TopicShareModel.findByShareIdWithAccessCheck(
        ctx.serverDB,
        input.shareId,
        ctx.userId ?? undefined,
      );

      // Increment page view count after visibility check passes
      await TopicShareModel.incrementPageViewCount(ctx.serverDB, input.shareId);

      return {
        agentId: share.agentId,
        agentMeta: share.agentId
          ? {
              avatar: share.agentAvatar,
              backgroundColor: share.agentBackgroundColor,
              marketIdentifier: share.agentMarketIdentifier,
              slug: share.agentSlug,
              title: share.agentTitle,
            }
          : undefined,
        groupId: share.groupId,
        groupMeta: share.groupId
          ? {
              avatar: share.groupAvatar,
              backgroundColor: share.groupBackgroundColor,
              createdAt: share.groupCreatedAt,
              members: share.groupMembers,
              title: share.groupTitle,
              updatedAt: share.groupUpdatedAt,
              userId: share.groupUserId,
            }
          : undefined,
        shareId: share.shareId,
        title: share.title,
        topicId: share.topicId,
        visibility: share.visibility as SharedTopicData['visibility'],
      };
    }),
});

export type ShareRouter = typeof shareRouter;

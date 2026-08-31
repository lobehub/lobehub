import { type SharedAgentData, type SharedTopicData } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { AgentShareModel } from '@/database/models/agentShare';
import { TopicShareModel } from '@/database/models/topicShare';
import { authedProcedure, publicProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

export const shareRouter = router({
  /**
   * Resolve the visitor-facing metadata for an agent share, by its custom
   * slug or its raw share id, after enforcing signed-in access.
   *
   * `findBySlugOrId` intentionally does NOT enforce visibility — it resolves
   * whatever share matches, of ANY visibility, so the id it returns can be
   * handed to `findByShareIdWithAccessCheck` for the actual (private → owner
   * only, link → any authed viewer) gate. Two lookups, not one, keeps the
   * access-check logic itself in a single tested place instead of
   * duplicating it here.
   */
  getSharedAgent: authedProcedure
    .use(serverDatabase)
    .input(z.object({ slugOrId: z.string().trim().min(1) }))
    .query(async ({ input, ctx }): Promise<SharedAgentData> => {
      const resolved = await AgentShareModel.findBySlugOrId(ctx.serverDB, input.slugOrId);

      if (!resolved) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Share not found' });
      }

      const share = await AgentShareModel.findByShareIdWithAccessCheck(
        ctx.serverDB,
        resolved.shareId,
        ctx.userId,
      );

      await AgentShareModel.incrementUserViewCount(ctx.serverDB, share.shareId);

      return {
        agentId: share.agentId,
        agentMeta: {
          avatar: share.agentAvatar,
          backgroundColor: share.agentBackgroundColor,
          description: share.agentDescription,
          name: share.agentName,
          title: share.agentTitle,
        },
        isOwner: share.ownerId === ctx.userId,
        shareId: share.shareId,
        slug: share.shareConfig.slug ?? null,
        // TODO(LOBE-11930 budget gate): surface a `budgetExhausted` flag once
        // the Cloud-side monthly spend gate (business slot) lands. This step
        // only carries the creator's configured `monthlySpendLimit`, not
        // enforcement/remaining-balance state.
        visibility: share.visibility as SharedAgentData['visibility'],
      };
    }),

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
              name: share.agentName,
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

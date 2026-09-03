import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import { type SharedAgentData, type SharedTopicData } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';
import { z } from 'zod';

import { AgentShareModel } from '@/database/models/agentShare';
import { TopicShareModel } from '@/database/models/topicShare';
import { authedProcedure, publicProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

import { assertAgentShareVisitorEnabled } from './_helpers/agentShareFeatureGate';

const log = debug('lobe-server:router:share');

export const shareRouter = router({
  /**
   * Resolve the visitor-facing metadata for an agent share, by its custom
   * slug or its raw share id, after enforcing signed-in access.
   *
   * `findBySlugOrId` intentionally does NOT enforce visibility — it resolves
   * whatever share matches, of ANY visibility; the (private → owner only,
   * link → any authed viewer) gate runs on the resolved row via the shared
   * `assertShareAccess` helper, so no second lookup is needed.
   *
   * Gated in two layers matching `_helpers/agentShareFeatureGate.ts`:
   * `ENABLE_BUSINESS_FEATURES` applies unconditionally (even to the OWNER
   * previewing their own share — an OSS deployment has no agent-share surface
   * at all), while the `enableAgentShare` grayscale flag only ever applies to
   * OTHER visitors, never the owner.
   */
  getSharedAgent: authedProcedure
    .use(serverDatabase)
    .input(z.object({ slugOrId: z.string().trim().min(1) }))
    .query(async ({ input, ctx }): Promise<SharedAgentData> => {
      if (!ENABLE_BUSINESS_FEATURES) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Agent sharing is not available on this deployment',
        });
      }

      const share = await AgentShareModel.findBySlugOrId(ctx.serverDB, input.slugOrId);

      if (!share) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Share not found' });
      }

      AgentShareModel.assertShareAccess(share, ctx.userId);

      const isOwner = share.ownerId === ctx.userId;

      if (!isOwner) {
        // The owner previewing their own (possibly unpublished) share must
        // always be able to see it — the grayscale rollout only narrows OTHER
        // visitors' admission.
        await assertAgentShareVisitorEnabled(ctx.userId);

        // Owner previews are not counted: userViewCount tracks visitor page
        // views (PV, not deduplicated visitors). The counter is analytics
        // only, so it is best-effort: a failed increment must never turn an
        // otherwise valid share page into an error for the visitor.
        try {
          await AgentShareModel.incrementUserViewCount(ctx.serverDB, share.shareId);
        } catch (error) {
          log('failed to increment view count for share %s: %O', share.shareId, error);
        }
      }

      return {
        agentId: share.agentId,
        agentMeta: {
          avatar: share.agentAvatar,
          backgroundColor: share.agentBackgroundColor,
          description: share.agentDescription,
          name: share.agentName,
          title: share.agentTitle,
        },
        isOwner,
        shareId: share.shareId,
        slug: share.shareConfig.slug ?? null,
        // TODO(cloud budget gate): the spend gate itself is already enforced —
        // `shareChat.execAgent` checks `checkAgentShareSpendAllowance` before
        // dispatching a run. This READ-ONLY endpoint just doesn't yet expose
        // whether the budget is currently exhausted; it only carries the
        // creator's configured `monthlySpendLimit`. Surfacing a `budgetExhausted`
        // flag here (so the visitor page can show the state before the visitor
        // even sends a message) is a tracked followup, not a missing gate.
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

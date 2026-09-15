import {
  AGENT_SHARE_DEFAULT_MAX_TOPICS_PER_VISITOR,
  AGENT_SHARE_DEFAULT_MAX_TURNS_PER_TOPIC,
} from '@lobechat/const';
import { type SharedAgentData, type SharedTopicData } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';
import { z } from 'zod';

import { AgentShareModel } from '@/database/models/agentShare';
import { TopicModel } from '@/database/models/topic';
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
   * Deployment support applies to every viewer, including owner previews.
   * The rollout flag only gates publishing, never access to an existing share.
   */
  getSharedAgent: authedProcedure
    .use(serverDatabase)
    .input(z.object({ slugOrId: z.string().trim().min(1) }))
    .query(async ({ input, ctx }): Promise<SharedAgentData> => {
      assertAgentShareVisitorEnabled();

      const share = await AgentShareModel.findBySlugOrId(ctx.serverDB, input.slugOrId);

      if (!share) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Share not found' });
      }

      AgentShareModel.assertShareAccess(share, ctx.userId);

      const isOwner = share.ownerId === ctx.userId;

      if (!isOwner) {
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

      // Reach numbers are scoped to the SHARE OWNER, not the caller: visitor
      // topics live under the creator's account, so the counter has to run as
      // them. Best-effort — analytics must never turn a valid share page into
      // an error.
      let stats = { conversations: 0, visitors: 0 };
      try {
        const topicModel = new TopicModel(ctx.serverDB, share.ownerId);
        const counts = await topicModel.countShareVisitors({ agentId: share.agentId });
        stats = { conversations: counts.topicCount, visitors: counts.visitorCount };
      } catch (error) {
        log('failed to count share visitors for %s: %O', share.shareId, error);
      }

      return {
        agentId: share.agentId,
        agentMeta: {
          avatar: share.agentAvatar,
          backgroundColor: share.agentBackgroundColor,
          description: share.agentDescription,
          name: share.agentName,
          openingQuestions: share.agentOpeningQuestions ?? [],
          tags: share.agentTags ?? [],
          title: share.agentTitle,
        },
        creator: {
          avatar: share.ownerAvatar ?? null,
          name: share.ownerFullName ?? share.ownerUsername ?? null,
        },
        isOwner,
        shareId: share.shareId,
        slug: share.shareConfig.slug ?? null,
        stats: { ...stats, views: share.userViewCount },
        terms: {
          allowCreatorViewSessions: share.shareConfig.allowCreatorViewSessions ?? false,
          maxTopicsPerVisitor:
            share.shareConfig.maxTopicsPerVisitor ?? AGENT_SHARE_DEFAULT_MAX_TOPICS_PER_VISITOR,
          maxTurnsPerTopic:
            share.shareConfig.maxTurnsPerTopic ?? AGENT_SHARE_DEFAULT_MAX_TURNS_PER_TOPIC,
        },
        // Identifiers only. The granted API list is owner-facing configuration
        // and must not reach a visitor.
        toolGrants: (share.shareConfig.toolGrants ?? []).map((grant) => grant.identifier),
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

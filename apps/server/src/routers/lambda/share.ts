import {
  AGENT_SHARE_DEFAULT_MAX_FILE_STORAGE,
  AGENT_SHARE_DEFAULT_MAX_TOPICS_PER_VISITOR,
  AGENT_SHARE_DEFAULT_MAX_TURNS_PER_TOPIC,
} from '@lobechat/const';
import {
  type SharedAgentData,
  type SharedAgentDeliveryStats,
  type SharedAgentUploadAbility,
  type SharedTopicData,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';
import type { ModelAbilities } from 'model-bank';
import { z } from 'zod';

import { AgentShareModel } from '@/database/models/agentShare';
import { AgentShareProfileModel } from '@/database/models/agentShareProfile';
import { AiModelModel } from '@/database/models/aiModel';
import { TopicModel } from '@/database/models/topic';
import { TopicShareModel } from '@/database/models/topicShare';
import type { LobeChatDatabase } from '@/database/type';
import { authedProcedure, publicProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { resolveModelMediaCapabilities } from '@/server/modules/AgentRuntime/resolveModelMediaCapabilities';
import { AgentService } from '@/server/services/agent';
import { getCachedDeliveryStats } from '@/server/services/agentShare/deliveryStatsCache';

import { assertAgentShareVisitorEnabled } from './_helpers/agentShareFeatureGate';

const log = debug('lobe-server:router:share');

/**
 * What media a visitor may attach to a turn on this share.
 *
 * Mirrors the runtime's own check (`toolDiscovery` → `resolveModelMediaCapabilities`
 * with the OWNER's model overrides on top of the bundled list) so the composer
 * gate and the context builder agree — an image the composer accepts must be
 * one the run can actually feed to the model. Resolved as the owner because
 * the run executes as them; the visitor's own provider setup is irrelevant.
 *
 * The model itself is resolved the way the run resolves it
 * (`AgentService.resolveModelSelection`): an agent with no model of its own
 * runs on the OWNER's default agent config, not on the global default, so
 * the gate has to look at that model too.
 *
 * Fails closed on lookup errors: media silently dropped server-side is worse
 * than a composer that refuses it with a reason. Documents never go through
 * this gate.
 */
const resolveVisitorUploadAbility = async (
  db: LobeChatDatabase,
  share: {
    agentModel: string | null;
    agentProvider: string | null;
    ownerId: string;
    workspaceId: string | null;
  },
): Promise<SharedAgentUploadAbility> => {
  try {
    const { loadModels } = await import('@/business/client/model-bank/loadModels');
    const [builtinModels, { model, provider }] = await Promise.all([
      loadModels(),
      new AgentService(db, share.ownerId, share.workspaceId ?? undefined).resolveModelSelection({
        model: share.agentModel,
        provider: share.agentProvider,
      }),
    ]);
    const ownerModel = await new AiModelModel(
      db,
      share.ownerId,
      share.workspaceId ?? undefined,
    ).findByIdAndProvider(model, provider);
    const abilities = resolveModelMediaCapabilities({
      builtinModels,
      model,
      provider,
      userAbilities: ownerModel?.abilities as ModelAbilities | undefined,
    });

    return {
      audio: abilities?.audio === true,
      image: abilities?.vision === true,
      video: abilities?.video === true,
    };
  } catch (error) {
    log(
      'failed to resolve upload ability for %s/%s (owner %s): %O',
      share.agentProvider,
      share.agentModel,
      share.ownerId,
      error,
    );
    return { audio: false, image: false, video: false };
  }
};

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
      const profileModel = new AgentShareProfileModel(ctx.serverDB, share.ownerId);
      let deliveryStats: SharedAgentDeliveryStats = {
        averageOperationDurationSeconds: null,
        averageWorkCost: null,
        lastDeliveredAt: null,
        workCount: 0,
      };
      const [uploadAbility, featuredWorks] = await Promise.all([
        resolveVisitorUploadAbility(ctx.serverDB, share),
        profileModel.listFeaturedWorks(share.agentId, share.shareConfig.featuredWorkIds ?? []),
        (async () => {
          try {
            deliveryStats = await getCachedDeliveryStats(
              ctx.serverDB,
              share.ownerId,
              share.agentId,
              () => profileModel.getStats(share.agentId),
            );
          } catch (error) {
            log('failed to count share deliveries for %s: %O', share.shareId, error);
          }
        })(),
        (async () => {
          try {
            const topicModel = new TopicModel(
              ctx.serverDB,
              share.ownerId,
              share.workspaceId ?? undefined,
            );
            const counts = await topicModel.countShareVisitors({ agentId: share.agentId });
            stats = { conversations: counts.topicCount, visitors: counts.visitorCount };
          } catch (error) {
            log('failed to count share visitors for %s: %O', share.shareId, error);
          }
        })(),
      ]);

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
        billingScope: share.workspaceId ? 'workspace' : 'personal',
        creator: {
          avatar: share.ownerAvatar ?? null,
          name: share.ownerFullName ?? share.ownerUsername ?? null,
        },
        demoCases: share.shareConfig.demoCases ?? [],
        featuredWorks,
        isOwner,
        shareId: share.shareId,
        slug: share.shareConfig.slug ?? null,
        stats: { ...stats, ...deliveryStats, views: share.userViewCount },
        terms: {
          allowCreatorViewSessions: share.shareConfig.allowCreatorViewSessions ?? false,
          maxFileStorage: share.shareConfig.maxFileStorage ?? AGENT_SHARE_DEFAULT_MAX_FILE_STORAGE,
          maxTopicsPerVisitor:
            share.shareConfig.maxTopicsPerVisitor ?? AGENT_SHARE_DEFAULT_MAX_TOPICS_PER_VISITOR,
          maxTurnsPerTopic:
            share.shareConfig.maxTurnsPerTopic ?? AGENT_SHARE_DEFAULT_MAX_TURNS_PER_TOPIC,
        },
        // Identifiers only. The granted API list is owner-facing configuration
        // and must not reach a visitor.
        toolGrants: (share.shareConfig.toolGrants ?? []).map((grant) => grant.identifier),
        uploadAbility,
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

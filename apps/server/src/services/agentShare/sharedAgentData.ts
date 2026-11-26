import { MemoryIdentifier } from '@lobechat/builtin-tool-memory';
import {
  AGENT_SHARE_DEFAULT_MAX_FILE_STORAGE,
  AGENT_SHARE_DEFAULT_MAX_MESSAGES_PER_VISITOR,
  DEFAULT_AGENT_CHAT_CONFIG,
} from '@lobechat/const';
import {
  getOptedInPluginIds,
  type SharedAgentData,
  type SharedAgentDeliveryStats,
  type SharedAgentUploadAbility,
} from '@lobechat/types';
import debug from 'debug';
import type { ModelAbilities } from 'model-bank';

import { loadModels } from '@/business/client/model-bank/loadModels';
import type { AgentShareModel } from '@/database/models/agentShare';
import { AgentShareProfileModel } from '@/database/models/agentShareProfile';
import { AiModelModel } from '@/database/models/aiModel';
import { TopicModel } from '@/database/models/topic';
import type { LobeChatDatabase } from '@/database/type';
import { resolveModelMediaCapabilities } from '@/server/modules/AgentRuntime/resolveModelMediaCapabilities';
import { AgentService } from '@/server/services/agent';
import { listShareActivatableExtensionIds } from '@/server/services/agentShare/activatableExtensions';
import { getCachedDeliveryStats } from '@/server/services/agentShare/deliveryStatsCache';
import { listShareGrantableSkills } from '@/server/services/agentShare/grantableSkills';
import { applyShareAutoAgentGrants } from '@/server/services/aiAgent/shareGate/autoGrants';

const log = debug('lobe-server:agent-share:shared-agent-data');

export type ResolvedAgentShare = NonNullable<
  Awaited<ReturnType<typeof AgentShareModel.findByShareId>>
>;

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

/**
 * The visitor landing page's data for a resolved share. Every value is read as
 * the share OWNER, never as the caller, so the visitor page and the creator's
 * settings preview render the same page. Callers own access checks and view
 * counting.
 */
export const buildSharedAgentData = async (
  db: LobeChatDatabase,
  share: ResolvedAgentShare,
  { isOwner }: { isOwner: boolean },
): Promise<SharedAgentData> => {
  // Reach numbers are scoped to the SHARE OWNER, not the caller: visitor
  // topics live under the creator's account, so the counter has to run as
  // them. Best-effort — analytics must never turn a valid share page into
  // an error.
  let stats = { conversations: 0, visitors: 0 };
  const profileModel = new AgentShareProfileModel(db, share.ownerId);
  let deliveryStats: SharedAgentDeliveryStats = {
    averageOperationDurationSeconds: null,
    averageWorkCost: null,
    lastDeliveredAt: null,
    workCount: 0,
  };
  const [uploadAbility, featuredWorks] = await Promise.all([
    resolveVisitorUploadAbility(db, share),
    profileModel.listFeaturedWorks(share.agentId, share.shareConfig.featuredWorkIds ?? []),
    (async () => {
      try {
        deliveryStats = await getCachedDeliveryStats(db, share.ownerId, share.agentId, () =>
          profileModel.getStats(share.agentId),
        );
      } catch (error) {
        log('failed to count share deliveries for %s: %O', share.shareId, error);
      }
    })(),
    (async () => {
      try {
        const topicModel = new TopicModel(db, share.ownerId, share.workspaceId ?? undefined);
        const counts = await topicModel.countShareVisitors({ agentId: share.agentId });
        stats = { conversations: counts.topicCount, visitors: counts.visitorCount };
      } catch (error) {
        log('failed to count share visitors for %s: %O', share.shareId, error);
      }
    })(),
  ]);

  // With `autoGrantAgentTools` on, visitors also get the tools the Agent
  // turns on; count those the way a visitor run resolves them.
  const { toolGrants } = share.shareConfig.autoGrantAgentTools
    ? applyShareAutoAgentGrants(share.shareConfig, {
        // LobeHub connections live in the creator's Market account, which a
        // visitor request cannot read; only the advertised count leaves them out.
        activatableExtensionIds: await listShareActivatableExtensionIds({
          agentId: share.agentId,
          db,
          userId: share.ownerId,
          workspaceId: share.workspaceId ?? undefined,
        }).then(
          (ids) => [...ids, ...getOptedInPluginIds(share.agentPlugins ?? [])],
          (error) => {
            log('failed to list connected extensions for %s: %O', share.shareId, error);
            return undefined;
          },
        ),
        chatConfig: { ...DEFAULT_AGENT_CHAT_CONFIG, ...share.agentChatConfig },
        plugins: share.agentPlugins ?? [],
        skillIds: (
          await listShareGrantableSkills({
            agentConfig: { chatConfig: share.agentChatConfig, plugins: share.agentPlugins },
            agentId: share.agentId,
            db,
            userId: share.ownerId,
            workspaceId: share.workspaceId ?? undefined,
          }).catch((error) => {
            // Only the advertised count degrades: pinned skills may be
            // counted as tools. The run resolves its own grants.
            log('failed to list grantable skills for %s: %O', share.shareId, error);
            return [];
          })
        ).map((skill) => skill.identifier),
      })
    : share.shareConfig;

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
    ownerWorkspaceSlug: isOwner ? (share.workspaceSlug ?? null) : null,
    shareId: share.shareId,
    slug: share.shareConfig.slug ?? null,
    stats: { ...stats, ...deliveryStats, views: share.userViewCount },
    terms: {
      allowCreatorViewSessions: share.shareConfig.allowCreatorViewSessions ?? false,
      maxFileStorage: share.shareConfig.maxFileStorage ?? AGENT_SHARE_DEFAULT_MAX_FILE_STORAGE,
      maxMessagesPerVisitor:
        share.shareConfig.maxMessagesPerVisitor ?? AGENT_SHARE_DEFAULT_MAX_MESSAGES_PER_VISITOR,
    },
    // Identifiers only. The granted API list is owner-facing configuration
    // and must not reach a visitor. A Claude Code / Codex Agent runs none of
    // LobeHub's tools, so grants stored before it switched harness are not
    // advertised (the settings page hides them too).
    toolGrants: share.agentAgencyConfig?.heterogeneousProvider
      ? []
      : (toolGrants ?? [])
          .map((grant) => grant.identifier)
          // A visitor run drops memory without the read permission.
          .filter(
            (identifier) => identifier !== MemoryIdentifier || !!share.shareConfig.allowReadMemory,
          ),
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
};

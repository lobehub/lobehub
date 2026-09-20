import { type AgentState, selectToolSourceMap } from '@lobechat/agent-runtime';
import { formatWebOnboardingStateMessage } from '@lobechat/builtin-tool-web-onboarding/utils';
import { defaultUninstalledBuiltinTools } from '@lobechat/builtin-tools';
import { AGENT_PLAN_FILE_TYPE } from '@lobechat/const';
import type { ContextFactProviders, ContextFactRequest } from '@lobechat/mecha';
import { getActivePluginIds } from '@lobechat/types';

import { loadModels } from '@/business/client/model-bank/loadModels';
import { composioEnv } from '@/config/composio';
import { AgentModel } from '@/database/models/agent';
import { AiModelModel } from '@/database/models/aiModel';
import { ChatGroupModel } from '@/database/models/chatGroup';
import { FileModel } from '@/database/models/file';
import { MessageModel } from '@/database/models/message';
import { PluginModel } from '@/database/models/plugin';
import { TopicModel } from '@/database/models/topic';
import { TopicDocumentModel } from '@/database/models/topicDocument';
import { UserModel } from '@/database/models/user';
import { UserPersonaModel } from '@/database/models/userMemory/persona';
import { WorkspaceModel } from '@/database/models/workspace';
import { appEnv } from '@/envs/app';
import { loadConnectedComposioIds } from '@/server/modules/AgentRuntime/adapters/composioConnectedIds';
import type { RuntimeExecutorContext } from '@/server/modules/AgentRuntime/context';
import { buildPostProcessUrl, log } from '@/server/modules/AgentRuntime/executorHelpers';
import { AgentDocumentsService } from '@/server/services/agentDocuments';
import { MarketService } from '@/server/services/market';
import { OnboardingService } from '@/server/services/onboarding';
import { toAgentContextDocuments } from '@/utils/agentDocumentContextMapping';

export interface ServerContextFactSource {
  ctx: RuntimeExecutorContext;
  state: AgentState;
}

/** Which connector families this deployment offers (mirrors the global config). */
export const resolveServerConnectorFeatures = (): ContextFactRequest['features'] => ({
  composio: !!composioEnv.COMPOSIO_API_KEY,
  lobehubSkill: !!(appEnv.MARKET_TRUSTED_CLIENT_SECRET && appEnv.MARKET_TRUSTED_CLIENT_ID),
});

const toIsoString = (value: Date | string | null | undefined): string =>
  value instanceof Date ? value.toISOString() : (value ?? '');

const getAppUrl = (): string | undefined => {
  try {
    return appEnv.APP_URL;
  } catch {
    return process.env.APP_URL;
  }
};

/**
 * How the server fetches the facts the shared context rules ask for. Every
 * method is a plain lookup against the database, the market service or the
 * run's own tool set; which facts a turn needs, and what a share visitor may
 * see, is decided by `gatherContextFacts` in `@lobechat/mecha`.
 */
export const createServerContextFactProviders = ({
  ctx,
  state,
}: ServerContextFactSource): ContextFactProviders => {
  const { serverDB, userId } = ctx;
  if (!serverDB || !userId) return {};
  const db = serverDB;
  const workspaceId = state.origin?.workspaceId ?? ctx.workspaceId;

  return {
    findTopic: async (topicId) => {
      const topic = await new TopicModel(db, userId, ctx.workspaceId).findById(topicId);
      if (!topic) return null;
      return {
        agentId: topic.agentId,
        groupId: topic.groupId,
        historySummary: topic.historySummary,
        id: topic.id,
        senderId: topic.senderId,
        title: topic.title,
      };
    },

    getAgentDefinition: async (agentId) => {
      const config = (await new AgentModel(db, userId, ctx.workspaceId).getAgentConfigById(
        agentId,
      )) as Record<string, any> | null;
      if (!config) return null;
      return {
        ...config,
        plugins: getActivePluginIds(Array.isArray(config.plugins) ? config.plugins : undefined),
      };
    },

    getGroup: async (groupId) => {
      const chatGroupModel = new ChatGroupModel(db, userId, ctx.workspaceId);
      const [group, roster] = await Promise.all([
        chatGroupModel.findById(groupId),
        chatGroupModel.getGroupAgentsWithMeta(groupId),
      ]);
      if (!group) return null;
      return {
        config: group.config,
        content: group.content,
        members: roster.map((member) => ({
          agentId: member.agentId,
          description: member.description,
          role: member.role === 'supervisor' ? 'supervisor' : 'participant',
          title: member.title,
        })),
        title: group.title,
      };
    },

    getOnboardingContext: async () => {
      const onboardingService = new OnboardingService(db, userId);
      const docService = new AgentDocumentsService(db, userId, workspaceId);
      const personaModel = new UserPersonaModel(db, userId);

      const [onboardingState, soulDoc, persona, userInfo] = await Promise.all([
        onboardingService.getState(),
        onboardingService
          .getInboxAgentId()
          .then((inboxAgentId) =>
            inboxAgentId ? docService.getDocumentByFilename(inboxAgentId, 'SOUL.md') : null,
          )
          .catch((error) => {
            log('Failed to fetch SOUL.md for onboarding context: %O', error);
            return null;
          }),
        personaModel.getLatestPersonaDocument().catch((error) => {
          log('Failed to fetch user persona for onboarding context: %O', error);
          return null;
        }),
        onboardingService.getInitialUserInfo().catch((error) => {
          log('Failed to fetch initial user info for onboarding context: %O', error);
          return undefined;
        }),
      ]);

      return {
        discoveryUserMessageCount: onboardingState.discoveryUserMessageCount,
        personaContent: persona?.persona ?? null,
        phaseGuidance: formatWebOnboardingStateMessage(onboardingState),
        remainingDiscoveryExchanges: onboardingState.remainingDiscoveryExchanges,
        soulContent: soulDoc?.content ?? null,
        userInfo,
      };
    },

    getPlanDocument: async (topicId) => {
      const [planDocument] = await new TopicDocumentModel(db, userId, workspaceId).findByTopicId(
        topicId,
        { type: AGENT_PLAN_FILE_TYPE },
      );
      if (!planDocument) return null;
      return {
        content: planDocument.content,
        createdAt: toIsoString(planDocument.createdAt),
        description: planDocument.description,
        id: planDocument.id,
        metadata: planDocument.metadata as { todos?: unknown } | null,
        title: planDocument.title,
        updatedAt: toIsoString(planDocument.updatedAt),
      };
    },

    getUserInfo: async (targetUserId) => {
      const info = await UserModel.getInfoForAIGeneration(db, targetUserId ?? userId);
      return { language: info.responseLanguage, username: info.userName };
    },

    getWorkspaceContext: async (targetWorkspaceId) => {
      const appUrl = getAppUrl();
      if (!targetWorkspaceId) return { appUrl };
      const workspace = await new WorkspaceModel(db, userId).findById(targetWorkspaceId);
      if (!workspace?.slug)
        log('Workspace %s has no slug; skipping workspace context', targetWorkspaceId);
      return { appUrl, slug: workspace?.slug ?? undefined };
    },

    listAgentDocuments: async (agentId) => {
      const docs = await new AgentDocumentsService(
        db,
        userId,
        workspaceId,
      ).getAgentContextDocuments(agentId);
      return toAgentContextDocuments(docs);
    },

    // Connected = ACTIVE Composio connections across BOTH the legacy plugin
    // projection AND the connector table, plus the LobeHub skill providers
    // discovered for this run (their manifests are only fetched for connected
    // providers, so presence in the tool set is the connection).
    listConnectedConnectorIds: async (agentId) => {
      const connected = await loadConnectedComposioIds(db, userId, ctx.workspaceId, agentId);
      const sourceMap = selectToolSourceMap(state);
      for (const [identifier, source] of Object.entries(sourceMap)) {
        if (source === 'lobehubSkill') connected.add(identifier);
      }
      return connected;
    },

    listCredentials: async ({ workspaceId: scopeWorkspaceId }) => {
      // Frozen when the operation was created, so a run renders {{CREDS_LIST}}
      // without a Market round trip per step. The scope must match: inside a
      // workspace the agent only sees that workspace's shared credentials.
      const frozen = state.operationCredentials;
      if (frozen && frozen.workspaceId === scopeWorkspaceId) return frozen.credentials;

      // Read market accessToken from DB so the server-side runtime can
      // authenticate with the Market API instead of falling back to an
      // anonymous trustedClientToken (which 401s on creds endpoints).
      let marketAccessToken: string | undefined;
      try {
        const settings = await new UserModel(db, userId).getUserSettings();
        marketAccessToken = (settings?.market as any)?.accessToken;
      } catch {
        // non-fatal — MarketService will fall back to trustedClientToken
      }
      const marketService = new MarketService({
        accessToken: marketAccessToken,
        userInfo: { userId },
      });
      // Inside a workspace, the agent must only see the workspace's shared
      // organization credentials — personal creds are not visible there.
      const result = scopeWorkspaceId
        ? await marketService.market.organizations.creds({ workspaceId: scopeWorkspaceId }).list()
        : await marketService.market.creds.list();
      const creds = (result as any)?.data ?? [];
      log('Fetched %d creds for {{CREDS_LIST}} substitution', creds.length);
      return creds.map((cred: any) => ({
        description: cred.description,
        key: cred.key,
        name: cred.name,
        ownerDisplayName: cred.ownerDisplayName,
        ownerType: cred.ownerType,
        type: cred.type,
      }));
    },

    // Custom MCP connectors the user installed, beyond the shared catalog.
    // Read from the installed-plugins table: the run's tool source map only
    // classifies skill / Composio / client tools, so it cannot tell a custom
    // connector apart, and a connector the agent has not pinned yet must
    // still be offered to createAgent / updateAgent.
    listCustomPlugins: async () => {
      const installed = await new PluginModel(db, userId, ctx.workspaceId).query();
      return installed
        .filter((plugin) => plugin.type === 'customPlugin')
        .map((plugin) => ({
          description: plugin.manifest?.meta?.description,
          identifier: plugin.identifier,
          name: plugin.manifest?.meta?.title || plugin.identifier,
          type: 'custom' as const,
        }));
    },

    listEnabledProviders: async () => {
      const [allUserModels, builtinModels] = await Promise.all([
        new AiModelModel(db, userId).getAllModels(),
        loadModels(),
      ]);
      const providerMap = new Map<
        string,
        {
          id: string;
          models: { abilities?: any; description?: string; id: string; name: string }[];
          name: string;
        }
      >();
      for (const userModel of allUserModels) {
        if (!userModel.enabled || userModel.type !== 'chat') continue;
        const modelInfo = builtinModels.find(
          (m) => m.id === userModel.id && m.providerId === userModel.providerId,
        );
        if (!providerMap.has(userModel.providerId)) {
          providerMap.set(userModel.providerId, {
            id: userModel.providerId,
            models: [],
            name: userModel.providerId,
          });
        }
        providerMap.get(userModel.providerId)!.models.push({
          abilities: userModel.abilities || modelInfo?.abilities,
          description: modelInfo?.description,
          id: userModel.id,
          name: userModel.displayName || modelInfo?.displayName || userModel.id,
        });
      }
      return [...providerMap.values()];
    },

    listRecentAgents: async (limit) =>
      (await new AgentModel(db, userId, ctx.workspaceId).queryAgents({ limit })).map((a) => ({
        description: a.description,
        id: a.id,
        title: a.title,
      })),

    // The uninstalled list lives on the user's tool settings, one slot per
    // workspace plus the personal one — the same slot the tool store reads.
    listUninstalledBuiltinIds: async () => {
      const settings = await new UserModel(db, userId).getUserSettings();
      const tool = settings?.tool as
        | {
            uninstalledBuiltinTools?: string[];
            uninstalledBuiltinToolsByWorkspace?: Record<string, string[] | undefined>;
          }
        | null
        | undefined;
      const stored = workspaceId
        ? tool?.uninstalledBuiltinToolsByWorkspace?.[workspaceId]
        : tool?.uninstalledBuiltinTools;
      // Never configured (new account, or a workspace without its own slot)
      // means the default seed — non-recommended builtins start uninstalled —
      // exactly as the browser's tool store resolves it.
      return stored === undefined ? defaultUninstalledBuiltinTools : stored;
    },

    listSandboxFiles: async (topicId) =>
      new FileModel(db, userId).findFilesToInitInSandbox(topicId),

    listTopicMessages: async (topic) => {
      const messages = await new MessageModel(db, userId, ctx.workspaceId).query(
        {
          agentId: topic.agentId ?? undefined,
          groupId: topic.groupId ?? undefined,
          topicId: topic.id,
        },
        // The shared rules already proved a visitor may see this topic, so
        // the creator-facing agent-share exclusion must not apply here.
        { allowShareVisitor: true, postProcessUrl: buildPostProcessUrl(ctx) },
      );
      return messages.map((message) => ({
        content: typeof message.content === 'string' ? message.content : '',
        role: message.role,
      }));
    },
  };
};

import { AGENT_PLAN_FILE_TYPE, isDesktop } from '@lobechat/const';
import type { ContextFactProviders, ContextFactRequest, CredentialSummary } from '@lobechat/mecha';
import { type AgentShareVisitorContext, getActivePluginIds } from '@lobechat/types';

import { getActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { lambdaClient } from '@/libs/trpc/client';
import { agentService } from '@/services/agent';
import { messageService } from '@/services/message';
import { notebookService } from '@/services/notebook';
import { userService } from '@/services/user';
import { getAgentStoreState } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { getChatGroupStoreState } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';
import { getAiInfraStoreState } from '@/store/aiInfra';
import { getChatStoreState } from '@/store/chat';
import { chatSelectors, topicSelectors } from '@/store/chat/selectors';
import { getElectronStoreState } from '@/store/electron';
import { electronSyncSelectors } from '@/store/electron/selectors';
import { getServerConfigStoreState } from '@/store/serverConfig';
import { serverConfigSelectors } from '@/store/serverConfig/selectors';
import { getToolStoreState } from '@/store/tool';
import {
  composioStoreSelectors,
  lobehubSkillStoreSelectors,
  pluginSelectors,
} from '@/store/tool/selectors';
import { ComposioServerStatus } from '@/store/tool/slices/composioStore';
import { getUserStoreState } from '@/store/user';
import { userGeneralSettingsSelectors, userProfileSelectors } from '@/store/user/selectors';

export interface BrowserContextFactSource {
  /** Executing agent, used to scope referenced-topic reads. */
  agentId?: string;
  groupId?: string;
  /** Present only when the browser answers a share visitor. */
  shareVisitor?: BrowserShareVisitor;
}

/**
 * The visitor context a browser caller can supply. `shareId` routes
 * referenced-topic reads through the share-authorized message endpoint.
 */
export type BrowserShareVisitor = Pick<AgentShareVisitorContext, 'agentId' | 'visitorUserId'> & {
  shareId?: string;
};

/** The topic row fields the store carries beyond the `ChatTopic` type. */
interface StoredTopicOwnership {
  agentId?: string | null;
  groupId?: string | null;
  senderId?: string | null;
}

/** Which connector families this deployment offers, as the server config reports. */
export const resolveBrowserConnectorFeatures = (): ContextFactRequest['features'] => {
  const serverConfig = getServerConfigStoreState();
  if (!serverConfig) return { composio: false, lobehubSkill: false };
  return {
    composio: serverConfigSelectors.enableComposio(serverConfig),
    lobehubSkill: serverConfigSelectors.enableLobehubSkill(serverConfig),
  };
};

const resolveClientAppOrigin = (): string | undefined => {
  if (isDesktop) return electronSyncSelectors.remoteServerUrl(getElectronStoreState()) || undefined;
  if (typeof window === 'undefined') return undefined;
  return window.location.origin || undefined;
};

const toIsoString = (value: Date | string | null | undefined): string =>
  value instanceof Date ? value.toISOString() : (value ?? '');

/**
 * How the browser fetches the facts the shared context rules ask for. Every
 * method reads the stores first and only goes to the network for what the
 * stores do not hold; which facts a turn needs is decided by
 * `gatherContextFacts` in `@lobechat/mecha`, the same way as on the server.
 */
export const createBrowserContextFactProviders = ({
  agentId,
  groupId,
  shareVisitor,
}: BrowserContextFactSource = {}): ContextFactProviders => ({
  findTopic: async (topicId) => {
    const topic = topicSelectors.getTopicById(topicId)(getChatStoreState());
    if (!topic) return null;
    const stored = topic as typeof topic & StoredTopicOwnership;
    return {
      // A visitor's store only ever holds topics the server already scoped to
      // this visitor and the shared agent (`shareChat.getTopics` queries by
      // sender + agent), so a cached topic without explicit ownership columns
      // is the visitor's own — the shared visibility rule must see it as such.
      agentId: stored.agentId ?? shareVisitor?.agentId,
      groupId: stored.groupId,
      historySummary: topic.historySummary,
      id: topic.id,
      senderId: stored.senderId ?? shareVisitor?.visitorUserId,
      title: topic.title,
    };
  },

  getAgentDefinition: async (targetAgentId) => {
    const state = getAgentStoreState();
    const config = agentSelectors.getAgentConfigById(targetAgentId)(state);
    const meta = agentSelectors.getAgentMetaById(targetAgentId)(state);
    if (!config) return null;
    return {
      avatar: meta?.avatar,
      backgroundColor: meta?.backgroundColor,
      chatConfig: config.chatConfig,
      description: meta?.description,
      model: config.model,
      name: meta?.name,
      openingMessage: config.openingMessage,
      openingQuestions: config.openingQuestions,
      params: config.params as Record<string, unknown> | undefined,
      plugins: getActivePluginIds(config.plugins),
      provider: config.provider,
      systemRole: config.systemRole,
      tags: meta?.tags,
      title: meta?.title,
    };
  },

  getGroup: async (targetGroupId) => {
    const group = agentGroupSelectors.getGroupById(targetGroupId)(getChatGroupStoreState());
    if (!group) return null;
    return {
      config: group.config,
      content: group.content,
      members: (group.agents ?? []).map((member) => ({
        agentId: member.id,
        description: member.description,
        role: member.isSupervisor ? 'supervisor' : 'participant',
        title: member.title,
      })),
      title: group.title,
    };
  },

  // Single combined trpc call — the server runs state/soul/persona queries in parallel.
  getOnboardingContext: () => userService.getOnboardingAgentContext(),

  getPlanDocument: async (topicId) => {
    const { data } = await notebookService.listDocuments({ topicId, type: AGENT_PLAN_FILE_TYPE });
    const planDocument = data[0];
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

  getUserInfo: async () => {
    const userState = getUserStoreState();
    return {
      language: userGeneralSettingsSelectors.responseLanguage(userState),
      username: userProfileSelectors.displayUserName(userState),
    };
  },

  getWorkspaceContext: async () => ({
    appUrl: resolveClientAppOrigin(),
    slug: getActiveWorkspaceSlug() ?? undefined,
  }),

  // Cache-first: the store dedupes in-flight hydration per agent.
  listAgentDocuments: (targetAgentId) => getAgentStoreState().ensureAgentDocuments(targetAgentId),

  listConnectedConnectorIds: async () => {
    const toolState = getToolStoreState();
    const connected = new Set<string>();
    for (const server of composioStoreSelectors.getServers(toolState)) {
      if (server.status === ComposioServerStatus.ACTIVE) connected.add(server.identifier);
    }
    for (const server of lobehubSkillStoreSelectors.getServers(toolState)) {
      connected.add(server.identifier);
    }
    return connected;
  },

  // The server resolves the scope from the verified workspace header: the
  // workspace's shared organization creds inside a workspace, personal
  // creds otherwise — the same rule the server runtime applies.
  listCredentials: async () => {
    const result = await lambdaClient.market.creds.listForContext.query();
    return result.data as CredentialSummary[];
  },

  listCustomPlugins: async () =>
    pluginSelectors.installedCustomPluginMetaList(getToolStoreState()).map((plugin) => ({
      description: plugin.description,
      identifier: plugin.identifier,
      name: plugin.title || plugin.identifier,
      type: 'custom' as const,
    })),

  listEnabledProviders: async () =>
    (getAiInfraStoreState().enabledChatModelList || []).map((provider) => ({
      id: provider.id,
      models: provider.children.map((model) => ({
        abilities: model.abilities,
        description: model.description,
        id: model.id,
        name: model.displayName || model.id,
      })),
      name: provider.name,
    })),

  // The prefetched list is reused when present so sending never waits on it.
  listRecentAgents: async (limit) =>
    getAgentStoreState().availableAgents ?? (await agentService.queryAgents({ limit })),

  // Non-recommended builtins are uninstalled by default; the builder must
  // not present them as installed and pin unusable identifiers.
  listUninstalledBuiltinIds: async () => getToolStoreState().uninstalledBuiltinTools,

  listSandboxFiles: async () =>
    chatSelectors
      .currentUserFiles(getChatStoreState())
      .map((file) => ({ name: file.name, size: file.size })),

  listTopicMessages: async (topic) => {
    const msgs = await messageService.getMessages({
      agentId,
      // Share rows belong to the creator; a visitor must read through the
      // share-authorized endpoint or the owner-scoped query comes back empty.
      agentShareId: shareVisitor?.shareId,
      groupId,
      topicId: topic.id,
    });
    return msgs.map((m) => ({
      content: typeof m.content === 'string' ? m.content : '',
      role: m.role,
    }));
  },
});

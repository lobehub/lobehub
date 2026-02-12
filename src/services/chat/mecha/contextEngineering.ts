import { AgentBuilderIdentifier } from '@lobechat/builtin-tool-agent-builder';
import { GroupAgentBuilderIdentifier } from '@lobechat/builtin-tool-group-agent-builder';
import { GTDIdentifier } from '@lobechat/builtin-tool-gtd';
import { isDesktop, KLAVIS_SERVER_TYPES, LOBEHUB_SKILL_PROVIDERS } from '@lobechat/const';
import {
  type AgentBuilderContext,
  type AgentGroupConfig,
  type GroupAgentBuilderContext,
  type GroupOfficialToolItem,
  type GTDConfig,
  type LobeToolManifest,
} from '@lobechat/context-engine';
import { MessagesEngine } from '@lobechat/context-engine';
import { historySummaryPrompt } from '@lobechat/prompts';
import {
  type OpenAIChatMessage,
  type RuntimeInitialContext,
  type RuntimeStepContext,
  type UIChatMessage,
} from '@lobechat/types';
import debug from 'debug';

import { isCanUseFC } from '@/helpers/isCanUseFC';
import { VARIABLE_GENERATORS } from '@/helpers/parserPlaceholder';
import { notebookService } from '@/services/notebook';
import { getAgentStoreState } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { getChatGroupStoreState } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';
import { getChatStoreState } from '@/store/chat';
import { getToolStoreState } from '@/store/tool';
import {
  builtinToolSelectors,
  klavisStoreSelectors,
  lobehubSkillStoreSelectors,
} from '@/store/tool/selectors';

import { isCanUseVideo, isCanUseVision } from '../helper';
import {
  combineUserMemoryData,
  resolveGlobalIdentities,
  resolveTopicMemories,
} from './memoryManager';

const log = debug('context-engine:contextEngineering');

interface ContextEngineeringContext {
  /** Agent Builder context for injecting current agent info */
  agentBuilderContext?: AgentBuilderContext;
  /** The agent ID that will respond (for group context injection) */
  agentId?: string;
  enableHistoryCount?: boolean;
  enableUserMemories?: boolean;
  /** Group ID for multi-agent scenarios */
  groupId?: string;
  historyCount?: number;
  historySummary?: string;
  /**
   * Initial context from Agent Runtime
   * Contains markdown and metadata captured at operation start
   */
  initialContext?: RuntimeInitialContext;
  inputTemplate?: string;
  /** Tool manifests with systemRole and API definitions */
  manifests?: LobeToolManifest[];
  messages: UIChatMessage[];
  model: string;
  provider: string;
  sessionId?: string;
  /**
   * Step context from Agent Runtime
   * Contains latest XML structure updated each step
   */
  stepContext?: RuntimeStepContext;
  systemRole?: string;
  tools?: string[];
  /** Topic ID for GTD context injection */
  topicId?: string;
}

// REVIEW: Maybe we can constrain identity, preference, exp to reorder or trim the context instead of passing everything in
export const contextEngineering = async ({
  messages = [],
  manifests,
  tools,
  model,
  provider,
  systemRole,
  inputTemplate,
  enableUserMemories,
  enableHistoryCount,
  historyCount,
  historySummary,
  agentBuilderContext,
  agentId,
  groupId,
  initialContext,
  stepContext,
  topicId,
}: ContextEngineeringContext): Promise<OpenAIChatMessage[]> => {
  log('tools: %o', tools);

  // Check if Agent Builder tool is enabled
  const isAgentBuilderEnabled = tools?.includes(AgentBuilderIdentifier) ?? false;
  // Check if Group Agent Builder tool is enabled
  const isGroupAgentBuilderEnabled = tools?.includes(GroupAgentBuilderIdentifier) ?? false;

  log('isAgentBuilderEnabled: %s', isAgentBuilderEnabled);
  log('isGroupAgentBuilderEnabled: %s', isGroupAgentBuilderEnabled);

  // Build agent group configuration if groupId is provided
  let agentGroup: AgentGroupConfig | undefined;
  if (groupId) {
    const groupStoreState = getChatGroupStoreState();
    const groupDetail = agentGroupSelectors.getGroupById(groupId)(groupStoreState);

    if (groupDetail?.agents && groupDetail.agents.length > 0) {
      const agentMap: AgentGroupConfig['agentMap'] = {};
      const members: AgentGroupConfig['members'] = [];

      // Find the responding agent to get its name and role
      let currentAgentName: string | undefined;
      let currentAgentRole: 'supervisor' | 'participant' | undefined;

      for (const agent of groupDetail.agents) {
        const role = agent.isSupervisor ? 'supervisor' : 'participant';
        const name = agent.title || 'Untitled Agent';

        agentMap[agent.id] = { name, role };
        members.push({ id: agent.id, name, role });

        // Capture responding agent info
        if (agentId && agent.id === agentId) {
          currentAgentName = name;
          currentAgentRole = role;
        }
      }

      agentGroup = {
        agentMap,
        currentAgentId: agentId,
        currentAgentName,
        currentAgentRole,
        groupTitle: groupDetail.title || undefined,
        members,
        // Use group.content as the group description (shared prompt/content)
        systemPrompt: groupDetail.content || undefined,
      };
      log('agentGroup built: %o', agentGroup);
    }
  }

  // Get agent store state (used for both group agent builder context and file/knowledge base)
  const agentStoreState = getAgentStoreState();

  // Build group agent builder context if Group Agent Builder is enabled
  // Note: Uses activeGroupId from chatStore to get the group being edited
  let groupAgentBuilderContext: GroupAgentBuilderContext | undefined;
  if (isGroupAgentBuilderEnabled) {
    const activeGroupId = getChatStoreState().activeGroupId;
    if (activeGroupId) {
      const groupStoreState = getChatGroupStoreState();
      const activeGroupDetail = agentGroupSelectors.getGroupById(activeGroupId)(groupStoreState);

      if (activeGroupDetail) {
        // Get supervisor agent config if supervisorAgentId exists
        let supervisorConfig: GroupAgentBuilderContext['supervisorConfig'];
        let enabledPlugins: string[] = [];
        if (activeGroupDetail.supervisorAgentId) {
          const supervisorAgentConfig = agentSelectors.getAgentConfigById(
            activeGroupDetail.supervisorAgentId,
          )(agentStoreState);
          supervisorConfig = {
            model: supervisorAgentConfig.model,
            plugins: supervisorAgentConfig.plugins,
            provider: supervisorAgentConfig.provider,
          };
          enabledPlugins = supervisorAgentConfig.plugins || [];
        }

        // Build official tools list (builtin tools + Klavis tools)
        const toolState = getToolStoreState();
        const officialTools: GroupOfficialToolItem[] = [];

        // Get builtin tools (excluding Klavis tools)
        const builtinTools = builtinToolSelectors.metaList(toolState);
        const klavisIdentifiers = new Set(KLAVIS_SERVER_TYPES.map((t) => t.identifier));

        for (const tool of builtinTools) {
          // Skip Klavis tools in builtin list (they'll be shown separately)
          if (klavisIdentifiers.has(tool.identifier)) continue;

          officialTools.push({
            description: tool.meta?.description,
            enabled: enabledPlugins.includes(tool.identifier),
            identifier: tool.identifier,
            installed: true,
            name: tool.meta?.title || tool.identifier,
            type: 'builtin',
          });
        }

        // Get Klavis tools (if enabled)
        const isKlavisEnabled =
          typeof window !== 'undefined' &&
          window.global_serverConfigStore?.getState()?.serverConfig?.enableKlavis;

        if (isKlavisEnabled) {
          const allKlavisServers = klavisStoreSelectors.getServers(toolState);

          for (const klavisType of KLAVIS_SERVER_TYPES) {
            const server = allKlavisServers.find((s) => s.identifier === klavisType.identifier);

            officialTools.push({
              description: `LobeHub Mcp Server: ${klavisType.label}`,
              enabled: enabledPlugins.includes(klavisType.identifier),
              identifier: klavisType.identifier,
              installed: !!server,
              name: klavisType.label,
              type: 'klavis',
            });
          }
        }

        // Get LobehubSkill providers (if enabled)
        const isLobehubSkillEnabled =
          typeof window !== 'undefined' &&
          window.global_serverConfigStore?.getState()?.serverConfig?.enableLobehubSkill;

        if (isLobehubSkillEnabled) {
          const allLobehubSkillServers = lobehubSkillStoreSelectors.getServers(toolState);

          for (const provider of LOBEHUB_SKILL_PROVIDERS) {
            const server = allLobehubSkillServers.find((s) => s.identifier === provider.id);

            officialTools.push({
              description: `LobeHub Skill Provider: ${provider.label}`,
              enabled: enabledPlugins.includes(provider.id),
              identifier: provider.id,
              installed: !!server,
              name: provider.label,
              type: 'lobehub-skill',
            });
          }
        }

        groupAgentBuilderContext = {
          config: {
            openingMessage: activeGroupDetail.config?.openingMessage || undefined,
            openingQuestions: activeGroupDetail.config?.openingQuestions,
            systemPrompt: activeGroupDetail.config?.systemPrompt || undefined,
          },
          groupId: activeGroupId,
          groupTitle: activeGroupDetail.title || undefined,
          members: activeGroupDetail.agents?.map((agent) => ({
            description: agent.description || undefined,
            id: agent.id,
            isSupervisor: agent.isSupervisor,
            title: agent.title || 'Untitled Agent',
          })),
          officialTools,
          supervisorConfig,
        };
        log('groupAgentBuilderContext built from activeGroupId: %o', groupAgentBuilderContext);
      }
    }
  }

  // Get enabled agent files with content and knowledge bases from agent store
  const agentFiles = agentSelectors.currentAgentFiles(agentStoreState);
  const agentKnowledgeBases = agentSelectors.currentAgentKnowledgeBases(agentStoreState);

  const fileContents = agentFiles
    .filter((file) => file.enabled && file.content)
    .map((file) => ({ content: file.content!, fileId: file.id, filename: file.name }));

  const knowledgeBases = agentKnowledgeBases
    .filter((kb) => kb.enabled)
    .map((kb) => ({ description: kb.description, id: kb.id, name: kb.name }));

  // Resolve user memories: topic memories and global identities are independent layers
  // Both functions now read from cache only (no network requests) to avoid blocking sendMessage
  let userMemoryData;
  if (enableUserMemories) {
    const topicMemories = resolveTopicMemories();
    const globalIdentities = resolveGlobalIdentities();
    userMemoryData = combineUserMemoryData(topicMemories, globalIdentities);
  }

  // Resolve GTD context: plan and todos
  // GTD tool must be enabled and topicId must be provided
  const isGTDEnabled = tools?.includes(GTDIdentifier) ?? false;
  let gtdConfig: GTDConfig | undefined;

  if (isGTDEnabled && topicId) {
    try {
      // Fetch plan document for the current topic
      const planResult = await notebookService.listDocuments({
        topicId,
        type: 'agent/plan',
      });

      if (planResult.data.length > 0) {
        const planDoc = planResult.data[0]; // Most recent plan

        // Build plan object for injection
        const plan = {
          completed: false, // TODO: Add completed field to document if needed
          context: planDoc.content ?? undefined,
          createdAt: planDoc.createdAt.toISOString(),
          description: planDoc.description || '',
          goal: planDoc.title || '',
          id: planDoc.id,
          updatedAt: planDoc.updatedAt.toISOString(),
        };

        // Get todos from plan's metadata
        const todos = planDoc.metadata?.todos;

        gtdConfig = {
          enabled: true,
          plan,
          todos,
        };

        log('GTD context resolved: plan=%s, todos=%o', plan.goal, todos?.items?.length ?? 0);
      }
    } catch (error) {
      // Silently fail - GTD context is optional
      log('Failed to resolve GTD context:', error);
    }
  }

  // Create MessagesEngine with injected dependencies
  /* eslint-disable sort-keys-fix/sort-keys-fix */
  const engine = new MessagesEngine({
    // Agent configuration
    enableHistoryCount,
    formatHistorySummary: historySummaryPrompt,
    historyCount,
    historySummary,
    inputTemplate,
    systemRole,

    // Capability injection
    capabilities: {
      isCanUseFC,
      isCanUseVideo,
      isCanUseVision,
    },

    // File context configuration
    fileContext: { enabled: true, includeFileUrl: !isDesktop },

    // Knowledge injection
    knowledge: {
      fileContents,
      knowledgeBases,
    },

    // Messages
    messages,

    // Model info
    model,
    provider,

    // runtime context
    initialContext,
    stepContext,

    // Tools configuration
    toolsConfig: {
      manifests,
      tools,
    },

    // User memory configuration
    userMemory:
      enableUserMemories && userMemoryData
        ? {
            enabled: enableUserMemories,
            memories: userMemoryData,
          }
        : undefined,

    // Variable generators
    variableGenerators: VARIABLE_GENERATORS,

    // Extended contexts - only pass when enabled
    ...(isAgentBuilderEnabled && { agentBuilderContext }),
    ...(isGroupAgentBuilderEnabled && { groupAgentBuilderContext }),
    ...(agentGroup && { agentGroup }),
    ...(gtdConfig && { gtd: gtdConfig }),
  });

  log('Input messages count: %d', messages.length);

  const result = await engine.process();

  log('Output messages count: %d', result.messages.length);

  if (messages.length > 0 && result.messages.length === 0) {
    log(
      'WARNING: Messages were reduced to 0! Input messages: %o',
      messages.map((m) => ({ id: m.id, role: m.role })),
    );
  }

  return result.messages;
};

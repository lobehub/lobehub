import { LobeActivatorIdentifier } from '@lobechat/builtin-tool-activator';
import { AgentBuilderIdentifier } from '@lobechat/builtin-tool-agent-builder';
import { isDesktop } from '@lobechat/const';
import type {
  AgentGroupConfig,
  LobeToolManifest,
  MemoryContext,
  OperationSkillSet,
  ToolDiscoveryConfig,
  UserMemoryData,
} from '@lobechat/context-engine';
import { type ContextSnapshot, gatherContextFacts, runContextEngineering } from '@lobechat/mecha';
import { historySummaryPrompt } from '@lobechat/prompts';
import {
  type OpenAIChatMessage,
  type RuntimeAdditionalContextFragment,
  type RuntimeInitialContext,
  type RuntimeStepContext,
  type UIChatMessage,
} from '@lobechat/types';
import debug from 'debug';

import { getActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { isCanUseFC } from '@/helpers/isCanUseFC';
import { HOST_VARIABLE_GENERATORS } from '@/helpers/parserPlaceholder';
import { getAgentStoreState } from '@/store/agent';
import {
  agentByIdSelectors,
  agentChatConfigSelectors,
  agentSelectors,
} from '@/store/agent/selectors';
import { getChatGroupStoreState } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';
import { getChatStoreState } from '@/store/chat';
import { getToolStoreState } from '@/store/tool';
import { toolSelectors } from '@/store/tool/selectors';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';

import {
  getRuntimeModelDisplayName,
  getRuntimeModelKnowledgeCutoff,
  isCanUseAudio,
  isCanUseVideo,
  isCanUseVision,
} from '../helper';
import {
  type BrowserShareVisitor,
  createBrowserContextFactProviders,
  resolveBrowserConnectorFeatures,
} from './contextFactProviders';
import { combineUserMemoryData, resolveTopicMemories, resolveUserPersona } from './memoryManager';
import { resolveClientSkills } from './skillEngineering';

const log = debug('context-engine:contextEngineering');

interface ContextEngineeringContext {
  /** Agent-materialized presentation contexts for this LLM call */
  additionalContexts?: readonly RuntimeAdditionalContextFragment[];
  /** The agent ID that will respond (for group context injection) */
  agentId?: string;
  /**
   * Identifiers the agent has explicitly disabled (`agents.plugins` tri-state).
   * Excluded from the client skill candidate pool entirely — not just left
   * out of `plugins` (pinned) — so a disabled skill is neither listed in
   * `<available_skills>` nor resolvable by name via `activateSkill`.
   */
  disabledPluginIds?: string[];
  /**
   * Runtime-resolved agent mode. Callers may force chat mode for models without
   * function calling while keeping the stored chatConfig unchanged.
   */
  enableAgentMode?: boolean;
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
  /** Memory-related context for prompt/runtime behavior */
  memoryContext?: MemoryContext;
  messages: UIChatMessage[];
  model: string;
  /** Agent's enabled plugin/tool/skill identifiers (from agentConfig.plugins) */
  plugins?: string[];
  provider: string;
  sessionId?: string;
  /**
   * Present only when the run answers a share visitor. The shared rules then
   * withhold the creator's documents, onboarding profile and workspace links
   * and resolve topic references against the visitor's own conversations.
   */
  shareVisitor?: BrowserShareVisitor;
  /**
   * Step context from Agent Runtime
   * Contains latest XML structure updated each step
   */
  stepContext?: RuntimeStepContext;
  systemRole?: string;
  tools?: string[];
  /** Topic ID for plan/todo context injection */
  topicId?: string;
}

// REVIEW: Maybe we can constrain identity, preference, exp to reorder or trim the context instead of passing everything in
export const contextEngineering = async ({
  additionalContexts,
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
  agentId,
  disabledPluginIds,
  enableAgentMode,
  groupId,
  initialContext,
  plugins,
  shareVisitor,
  stepContext,
  topicId,
  memoryContext,
}: ContextEngineeringContext): Promise<OpenAIChatMessage[]> => {
  log('tools: %o', tools);

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

  // Agent store state: chat mode, knowledge and identity of the responding agent.
  const agentStoreState = getAgentStoreState();
  // Example: preset-task calls omit `enableAgentMode`; preserve explicit chat mode
  // from stored config instead of letting MessagesEngine treat `undefined` as agent mode.
  const effectiveEnableAgentMode =
    enableAgentMode ?? agentChatConfigSelectors.currentChatConfig(agentStoreState).enableAgentMode;

  // Get enabled agent files with content and knowledge bases from agent store
  const agentFiles = agentSelectors.currentAgentFiles(agentStoreState);
  const agentKnowledgeBases = agentSelectors.currentAgentKnowledgeBases(agentStoreState);

  const fileContents = agentFiles
    .filter((file) => file.enabled && file.content)
    .map((file) => ({ content: file.content!, fileId: file.id, filename: file.name }));

  const knowledgeBases = agentKnowledgeBases
    .filter((kb) => kb.enabled)
    .map((kb) => ({ description: kb.description, id: kb.id, name: kb.name }));

  // Resolve user memories: topic memories and user persona are independent layers
  // Both functions now read from cache only (no network requests) to avoid blocking sendMessage
  let userMemoryData: UserMemoryData | undefined;
  if (enableUserMemories) {
    const topicMemories = resolveTopicMemories();
    const persona = resolveUserPersona();
    userMemoryData = combineUserMemoryData(topicMemories, persona);
  }

  const userMemoryConfig =
    enableUserMemories && userMemoryData
      ? {
          enabled: enableUserMemories,
          memories: userMemoryData,
        }
      : undefined;

  // Build tool discovery config if lobe-activator is enabled
  const enabledToolSet = new Set(tools || []);
  const isLobeToolsEnabled = enabledToolSet.has(LobeActivatorIdentifier);

  let toolDiscoveryConfig: ToolDiscoveryConfig | undefined;
  if (isLobeToolsEnabled) {
    const toolState = getToolStoreState();
    const availableTools = toolSelectors
      .availableToolsForDiscovery(toolState)
      .filter((tool) => !enabledToolSet.has(tool.identifier));

    if (availableTools.length > 0) {
      toolDiscoveryConfig = { availableTools };
      log('Tool discovery config built, available tools count: %d', availableTools.length);
    }
  }

  // Which facts this turn needs (plan, references, builder contexts, agent
  // management, credentials, connectors, onboarding, workspace links) is
  // decided by the shared rules; the browser only answers the lookups they
  // ask for, from the stores first.
  const chatStoreState = getChatStoreState();
  const agentConfig = agentId
    ? agentSelectors.getAgentConfigById(agentId)(agentStoreState)
    : undefined;
  const agentMeta = agentId ? agentSelectors.getAgentMetaById(agentId)(agentStoreState) : undefined;
  const agentItem = agentId ? agentByIdSelectors.getAgentById(agentId)(agentStoreState) : undefined;
  const facts = await gatherContextFacts(
    {
      agent: {
        // The current-agent chat config carries the skill activation mode the
        // management rule reads, even when `agentId` is a transient target.
        chatConfig:
          agentConfig?.chatConfig ?? agentChatConfigSelectors.currentChatConfig(agentStoreState),
        description: agentMeta?.description,
        slug: agentItem?.slug,
        title: agentMeta?.title,
      },
      agentId,
      disabledPluginIds,
      // The Profile panel edits `activeAgentId` / `activeGroupId`, not the
      // builder agent that is answering.
      editingAgentId: tools?.includes(AgentBuilderIdentifier)
        ? chatStoreState.activeAgentId || agentId
        : undefined,
      editingGroupId: chatStoreState.activeGroupId || undefined,
      enabledToolIds: tools ?? [],
      features: resolveBrowserConnectorFeatures(),
      mentionedAgents: initialContext?.mentionedAgents,
      messages,
      shareVisitor,
      topicId,
      workspaceId: getActiveWorkspaceId() ?? undefined,
    },
    createBrowserContextFactProviders({ agentId, groupId, shareVisitor }),
  );

  // Resolve enabled skills (await: pinned DB skills fetch their content on demand).
  // In auto mode: expose all installed skills so the AI can discover and activate them.
  // In manual mode: only expose user-selected skills (filtered by pluginIds).
  let enabledSkills: OperationSkillSet['skills'] | undefined;
  if (plugins) {
    // Manual mode does not hide the other skills: it withholds the discovery
    // tools that would let the model activate them, matching the server
    // runtime. The listing stays, so the model can tell the user what exists.
    enabledSkills = (await resolveClientSkills(plugins, disabledPluginIds)).skills;
  }

  // One timezone for every date the prompt renders — the core's temporal
  // placeholders (including `session_date`) and the system-date line — so a
  // run near midnight cannot carry two different dates.
  const userTimezone = userGeneralSettingsSelectors.currentTimezone(useUserStore.getState());

  // Everything gathered above is host-specific; shaping it into engine
  // parameters is shared with the server through `@lobechat/mecha`.
  const snapshot: ContextSnapshot = {
    agent: {
      documents: facts.agentDocuments,
      enableHistoryCount,
      historyCount,
      // The agent's identity lives on the agent row (name/title), not in the
      // prompt text — inject it so the model can answer "who are you?" with
      // the name the user gave it instead of the product/model name.
      identity: { name: agentMeta?.name, title: agentMeta?.title },
      inputTemplate,
      knowledge: { fileContents, knowledgeBases },
      systemRole,
    },
    // Desktop local/static URLs are not fetchable by remote providers or cloud tools.
    fileContext: { enabled: true, includeFileUrl: !isDesktop },
    model: {
      capabilities: { isCanUseAudio, isCanUseFC, isCanUseVideo, isCanUseVision },
      displayName: getRuntimeModelDisplayName(model, provider),
      knowledgeCutoff: getRuntimeModelKnowledgeCutoff(model, provider),
      model,
      provider,
    },
    run: {
      additionalContexts,
      // MessagesEngine force-disables skills / agent-document injectors when this
      // is `false` (chat mode). ChatService resolves it from stored user intent
      // plus the selected model's function-call ability.
      enableAgentMode: effectiveEnableAgentMode,
      formatHistorySummary: historySummaryPrompt,
      historySummary,
      initialContext,
      messages,
      stepContext,
    },
    step: facts.step,
    tools: {
      enabledSkills,
      enabledToolIds: tools,
      manifests,
      // Selected skills/tools from user for this request
      selectedSkills: initialContext?.selectedSkills,
      selectedTools: initialContext?.selectedTools,
      toolDiscoveryConfig,
    },
    // Placeholders resolved by the shared rules (credentials, connectors,
    // sandbox files, agent / topic identity) plus the browser's own lazy
    // store-backed generators. Temporal placeholders are not among them: the
    // core renders those in the user's timezone, the same way on every host.
    variables: {
      ...facts.variables,
      ...HOST_VARIABLE_GENERATORS,
      // NOTICE(@nekomeowww): required by builtin-tool-memory/src/systemRole.ts —
      // the browser knows the effective effort (agent override, else the user
      // setting), which the agent row alone cannot tell.
      memory_effort: () => (userMemoryConfig ? (memoryContext?.effort ?? '') : ''),
    },
    world: {
      group: agentGroup,
      userMemory: userMemoryConfig,
      userTimezone,
    },
  };

  log('Input messages count: %d', messages.length);

  const processed = await runContextEngineering(snapshot);

  log('Output messages count: %d', processed.length);

  if (messages.length > 0 && processed.length === 0) {
    log(
      'WARNING: Messages were reduced to 0! Input messages: %o',
      messages.map((m) => ({ id: m.id, role: m.role })),
    );
  }

  return processed;
};

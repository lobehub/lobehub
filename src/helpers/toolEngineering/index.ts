/**
 * Tools Engineering - Unified tools processing using ToolsEngine
 */
import { AuvManifest } from '@lobechat/builtin-tool-auv';
import {
  getUnavailableBuiltinToolIds,
  getUserDisabledToolIds,
  isOnDemandBuiltinTool,
} from '@lobechat/builtin-tools';
import { getFeatureDisabledToolIds } from '@lobechat/builtin-tools/featureGates';
import { serverOnlyToolIds } from '@lobechat/builtin-tools/serverOnly';
import {
  createEnableChecker,
  type LobeToolManifest,
  type PluginEnableChecker,
  ToolsEngine,
} from '@lobechat/context-engine';
import { assembleManifestPool, resolveToolRules } from '@lobechat/mecha';
import {
  type AgentPluginEntry,
  type BuiltinToolResolveContext,
  type ChatCompletionTool,
  getActivePluginIds,
  getBuiltinOverrides,
  getOptedInPluginIds,
  type LobeAgentChatConfig,
  resolveToolMode,
  type ToolManifest,
  type WorkingModel,
} from '@lobechat/types';

import { applyToolNameMaxLength } from '@/helpers/applyToolNameMaxLength';
import { isToolAvailableInCurrentEnv } from '@/helpers/toolAvailability';
import { getRunConnectors } from '@/services/runConnectors';
import { getAgentStoreState } from '@/store/agent';
import {
  agentChatConfigSelectors,
  agentSelectors,
  chatConfigByIdSelectors,
} from '@/store/agent/selectors';
import { aiModelSelectors, getAiInfraStoreState } from '@/store/aiInfra';
import { getServerConfigStoreState } from '@/store/serverConfig';
import { getToolStoreState } from '@/store/tool';
import {
  composioStoreSelectors,
  lobehubSkillStoreSelectors,
  pluginSelectors,
} from '@/store/tool/selectors';
import { runtimeUninstalledBuiltinTools } from '@/store/tool/slices/builtin/projection';
import {
  composioIdsOutsideRun,
  connectorSelectors,
  pickRunConnectors,
  pickRunToolSets,
} from '@/store/tool/slices/connector';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';

import { getSearchConfig } from '../getSearchConfig';
import { isCanUseFC } from '../isCanUseFC';
import { buildClientConnectorManifests } from './buildClientConnectorManifests';
import {
  type AgentConnectorActivation,
  applyAgentConnectorActivation,
  resolveAgentConnectorActivation,
} from './connectorActivation';

/**
 * Tools engine configuration options
 */
export interface ToolsEngineConfig {
  /** Additional manifests to include beyond the standard ones */
  additionalManifests?: ToolManifest[];
  /**
   * The agent the run belongs to: a connector mounted on it outranks a free one
   * of the same identifier, and one mounted on another agent is left out, as
   * the server resolves them.
   */
  agentId?: string;
  /** Default tool IDs that will always be added to the end of the tools list */
  defaultToolIds?: string[];
  /**
   * Identifiers the agent has explicitly disabled (`agents.plugins` tri-state).
   * Dropped from the combined manifest pool entirely — not just the
   * enableChecker rule map — because `allowExplicitActivation` lets the
   * activator resolve/enable any manifest present in `manifestSchemas`
   * regardless of the rules, bypassing a rule-only gate.
   */
  disabledPluginIds?: string[];
  /** Custom enable checker for plugins */
  enableChecker?: PluginEnableChecker;
  /**
   * Offer the caller's private (私人) workspace connectors. Only a private
   * agent's own conversation may load them — the server applies the same rule
   * when it resolves the call — so every other caller leaves them out.
   */
  includePrivateConnectors?: boolean;
  /**
   * Runtime context for context-aware builtin manifests. When provided, each
   * builtin tool with a `resolveManifest` produces its manifest for this context
   * (trimming APIs or opting out via `null`). Omit for context-free callers
   * (e.g. UI token estimation) — they get the full static manifests.
   */
  manifestContext?: BuiltinToolResolveContext;
  /**
   * The conversation's topic: with `agentId`, the connector rows the server
   * listed for it (`connector.listForRun`) are the run's tool sets.
   */
  topicId?: string;
}

/**
 * Initialize ToolsEngine with current manifest schemas and configurable options
 */
export const createToolsEngine = (config: ToolsEngineConfig = {}): ToolsEngine => {
  const {
    enableChecker,
    additionalManifests = [],
    agentId,
    topicId,
    defaultToolIds,
    disabledPluginIds = [],
    includePrivateConnectors = false,
    manifestContext,
  } = config;

  // Push the deployment's `TOOL_NAME_MAX_LENGTH` in before any tool name is
  // generated — the client mirror of `createServerToolsEngine`. Without it a
  // deployment setting `0` would still get `MD5HASH_…` names on this path.
  applyToolNameMaxLength();

  const toolStoreState = getToolStoreState();

  // The row each identifier runs on for tools another path executes (plugins,
  // Composio, LobeHub skills), whose permissions are keyed by identifier.
  const runConnectors = pickRunConnectors(connectorSelectors.connectorList(toolStoreState), {
    agentId,
    includePrivate: includePrivateConnectors,
  });

  // The connector tool sets: one per row the run may use, each under its own
  // tool prefix. The conversation's server listing decides which rows those
  // are — only it can tell whether this conversation may run the caller's own
  // connections, and only it holds their personal ones; without a listing the
  // local list stands in, split per row the way the server splits it.
  // An agent-owned connection stands alone for its identifier, as the server's
  // `pickConnectorToolSets` keeps a row bound to the agent.
  const agentOwned = agentId
    ? (toolStoreState.agentConnectors?.[agentId] ?? []).filter((c) => c.agentId === agentId)
    : [];
  const ownedIds = new Set(agentOwned.map((c) => c.identifier));
  const listed = agentId ? getRunConnectors({ agentId, topicId }) : undefined;
  const connectorToolSets = connectorSelectors
    .executableMcpConnectors({
      connectors:
        listed ??
        pickRunToolSets(
          [
            ...agentOwned,
            ...(toolStoreState.connectors ?? []).filter((c) => !ownedIds.has(c.identifier)),
          ],
          { agentId, includePrivate: includePrivateConnectors },
        ),
      installedPlugins: toolStoreState.installedPlugins,
    })
    .filter((c) => c.isEnabled && c.status === 'connected');

  // A Composio app whose only connections this run may not use offers no tools
  const composioOutsideRun = composioIdsOutsideRun(
    connectorSelectors.connectorList(toolStoreState),
    { agentId, includePrivate: includePrivateConnectors, listed },
  );

  // Per-connector tool permissions, keyed by connector identifier: community-
  // MCP plugins execute outside the connector path, so the user's
  // needs_approval / disabled settings are patched onto their manifests.
  const connectorPermissions = new Map(
    runConnectors.map(
      (c) => [c.identifier, new Map(c.tools.map((t) => [t.toolName, t.permission]))] as const,
    ),
  );

  // The pool rules (connector precedence, permission patching, context-aware
  // builtins, invalid manifest guard, disabled-id exclusion) are shared with
  // the server; the browser only reads its stores.
  const { manifests } = assembleManifestPool(
    {
      additional: additionalManifests as LobeToolManifest[],
      builtinTools: toolStoreState.builtinTools,
      composio: composioStoreSelectors
        .composioAsLobeTools(toolStoreState)
        .filter((tool) => !composioOutsideRun.has(tool.identifier))
        .map((tool) => tool.manifest as LobeToolManifest),
      connectors: buildClientConnectorManifests(connectorToolSets) as LobeToolManifest[],
      installedPlugins: pluginSelectors.installedPluginManifestList(
        toolStoreState,
      ) as LobeToolManifest[],
      lobehubSkills: lobehubSkillStoreSelectors
        .lobehubSkillAsLobeTools(toolStoreState)
        .map((tool) => tool.manifest as LobeToolManifest),
    },
    {
      connectorPermissions,
      // Disabled identifiers leave the pool outright: explicit activation
      // bypasses the enable rules, so a rule-only gate would not hold.
      excludedIdentifiers: disabledPluginIds,
      manifestContext,
    },
  );

  // A plain Web client must not acquire the Electron IPC executor: Computer
  // Use only exists where the platform can run it.
  const allManifests = manifests.filter(
    (m) => m.identifier !== AuvManifest.identifier || isToolAvailableInCurrentEnv(m.identifier),
  );

  return new ToolsEngine({
    defaultToolIds,
    enableChecker,
    functionCallChecker: isCanUseFC,
    manifestSchemas: allManifests as ToolManifest[],
  });
};

/** Conversation scopes whose transcript other members can read. */
const PRIVATE_CONNECTOR_EXCLUDED_SCOPES = new Set(['group', 'group_agent', 'sub_agent']);

export const createAgentToolsEngine = (
  workingModel: WorkingModel,
  /** Runtime-resolved plugin IDs (from agentConfigResolver), may include tools beyond the active agent */
  pluginIds?: string[],
  /** Conversation context for context-aware builtin manifests (scope, isSubAgent). */
  manifestContext?: BuiltinToolResolveContext,
  options: {
    /**
     * Whether the conversation has an attachment that can be sent as a preview. Enables
     * `readAttachment` so the preview can be paged, as the server's tool discovery does.
     */
    hasOversizedFiles?: boolean;
    /** The conversation's topic: its server-listed connector rows are the run's tool sets. */
    topicId?: string;
    uninstalledBuiltinTools?: string[];
    /** Resolved for the executing agent, which can differ from the agent open in the UI. */
    runAgent?: {
      id?: string;
      chatConfig?: LobeAgentChatConfig;
      connectors?: AgentConnectorActivation;
      enabledPluginIds?: string[];
      plugins?: AgentPluginEntry[];
    };
  } = {},
) => {
  const searchConfig = getSearchConfig(
    workingModel.model,
    workingModel.provider,
    options.runAgent?.id,
  );
  const agentState = getAgentStoreState();
  const targetAgentId = options.runAgent?.id ?? agentState.activeAgentId ?? '';
  const agent = options.runAgent ?? {
    id: targetAgentId,
    chatConfig: agentChatConfigSelectors.currentChatConfig(agentState),
    plugins: agentSelectors.currentAgentConfig(agentState)?.plugins,
  };
  const chatConfig = agent.chatConfig ?? {};
  const connectors =
    options.runAgent?.connectors ?? resolveAgentConnectorActivation(agent, pluginIds);

  // The rules — mode, per-tool enablement and defaults — are shared with the
  // server runtime through `@lobechat/mecha`; the browser only assembles its
  // facts. It has no device gateway, so no device walls apply here and the
  // remaining platform gate stays in `platformFilter` below.
  const resolved = resolveToolRules({
    agent: {
      chatConfig,
      plugins: applyAgentConnectorActivation(
        options.runAgent?.enabledPluginIds ??
          (resolveToolMode(chatConfig) === 'agent'
            ? getActivePluginIds(agent.plugins).filter((id) => !isOnDemandBuiltinTool(id))
            : getOptedInPluginIds(agent.plugins)),
        connectors,
      ),
    },
    // Feature-flagged tools (e.g. builtin-dashboard) leave the pool while their
    // flag is off for this user.
    disabledPluginIds: [
      ...getUserDisabledToolIds(agent.plugins, chatConfig),
      ...connectors.offIds,
      ...getUnavailableBuiltinToolIds(
        [
          ...getOptedInPluginIds(agent.plugins),
          ...(options.runAgent?.enabledPluginIds ?? []),
          ...(pluginIds ?? []),
        ],
        chatConfig,
        options.uninstalledBuiltinTools ?? runtimeUninstalledBuiltinTools(getToolStoreState()),
        getBuiltinOverrides(agent.plugins),
      ),
      ...getFeatureDisabledToolIds(getServerConfigStoreState()?.featureFlags),
      // This engine serves runs the browser executes; server-only tools have nothing to run here.
      ...serverOnlyToolIds,
      // This engine serves runs the browser executes; server-only tools have nothing to run here.
    ],
    executionTarget: chatConfigByIdSelectors.getExecutionTargetById(targetAgentId)(agentState),
    hasEnabledKnowledgeBases: options.runAgent?.id
      ? agentSelectors
          .getAgentConfigById(targetAgentId)(agentState)
          ?.knowledgeBases?.some((kb) => kb.enabled)
      : agentSelectors.hasEnabledKnowledgeBases(agentState),
    hasOversizedFiles: options.hasOversizedFiles,
    // A `local` target only resolves on the desktop, where the host itself is
    // the machine: local tools are always reachable there.
    localExecutionReady: true,
    memoryEnabled:
      chatConfig.memory?.enabled ?? settingsSelectors.memoryEnabled(useUserStore.getState()),
    model: {
      canUseFC: isCanUseFC(workingModel.model, workingModel.provider),
      hasImageOutput: aiModelSelectors.isModelSupportImageOutput(
        workingModel.model,
        workingModel.provider,
      )(getAiInfraStoreState()),
    },
    runtimePluginIds: pluginIds,
    useApplicationBuiltinSearchTool: searchConfig.useApplicationBuiltinSearchTool,
  });

  return createToolsEngine({
    agentId: targetAgentId || undefined,
    topicId: options.topicId,
    defaultToolIds: resolved.defaultToolIds,
    disabledPluginIds: [...resolved.excludedIdentifiers],
    // A private agent's own conversation only: a group or sub-agent run writes
    // into a conversation other members can read.
    includePrivateConnectors:
      agentSelectors.currentAgentVisibility(agentState) === 'private' &&
      !manifestContext?.isSubAgent &&
      !PRIVATE_CONNECTOR_EXCLUDED_SCOPES.has(manifestContext?.scope ?? ''),
    manifestContext,
    enableChecker: createEnableChecker({
      allowExplicitActivation: resolved.allowExplicitActivation,
      explicitActivationIds:
        resolved.toolMode === 'custom'
          ? new Set(connectors.connectorIds.filter(connectors.activation.isAllowed))
          : undefined,
      platformFilter: ({ pluginId }) => {
        const toolStoreState = getToolStoreState();
        const installedPlugin = pluginSelectors.getInstalledPluginById(pluginId)(toolStoreState);

        if (
          !isToolAvailableInCurrentEnv(pluginId, {
            installedPlugins: installedPlugin ? [installedPlugin] : toolStoreState.installedPlugins,
          })
        ) {
          return false;
        }

        return undefined; // fall through to rules
      },
      rules: resolved.rules,
    }),
  });
};

/**
 * Provides the same functionality using ToolsEngine with enhanced capabilities
 *
 * @param toolIds - Array of tool IDs to generate tools for
 * @param model - Model name for function calling compatibility check (optional)
 * @param provider - Provider name for function calling compatibility check (optional)
 * @returns Array of ChatCompletionTool objects
 */
export const getEnabledTools = (
  toolIds: string[] = [],
  model: string,
  provider: string,
): ChatCompletionTool[] => {
  const toolsEngine = createToolsEngine();

  return (
    toolsEngine.generateTools({
      model, // Use provided model or fallback
      provider, // Use provided provider or fallback
      toolIds,
    }) || []
  );
};

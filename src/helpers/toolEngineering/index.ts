/**
 * Tools Engineering - Unified tools processing using ToolsEngine
 */
import { CloudSandboxManifest } from '@lobechat/builtin-tool-cloud-sandbox';
import { KnowledgeBaseManifest } from '@lobechat/builtin-tool-knowledge-base';
import { LocalSystemManifest } from '@lobechat/builtin-tool-local-system';
import { MemoryManifest } from '@lobechat/builtin-tool-memory';
import { WebBrowsingManifest } from '@lobechat/builtin-tool-web-browsing';
import { alwaysOnToolIds, chatModeAllowedToolIds, defaultToolIds } from '@lobechat/builtin-tools';
import { createEnableChecker, type PluginEnableChecker } from '@lobechat/context-engine';
import { ToolsEngine } from '@lobechat/context-engine';
import {
  type BuiltinToolManifest,
  type BuiltinToolResolveContext,
  type ChatCompletionTool,
  type ToolManifest,
  type WorkingModel,
} from '@lobechat/types';

import type { ConnectorToolPermission } from '@/database/schemas';
import { isToolAvailableInCurrentEnv } from '@/helpers/toolAvailability';
import { patchManifestWithPermissions } from '@/libs/mcp/patchManifestPermissions';
import { getAgentStoreState } from '@/store/agent';
import { agentChatConfigSelectors, agentSelectors } from '@/store/agent/selectors';
import { getToolStoreState } from '@/store/tool';
import {
  composioStoreSelectors,
  lobehubSkillStoreSelectors,
  pluginSelectors,
} from '@/store/tool/selectors';
import { connectorSelectors } from '@/store/tool/slices/connector';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';

import { getSearchConfig } from '../getSearchConfig';
import { isCanUseFC } from '../isCanUseFC';
import { buildClientConnectorManifests } from './buildClientConnectorManifests';

/**
 * Tools engine configuration options
 */
export interface ToolsEngineConfig {
  /** Additional manifests to include beyond the standard ones */
  additionalManifests?: ToolManifest[];
  /** Default tool IDs that will always be added to the end of the tools list */
  defaultToolIds?: string[];
  /** Custom enable checker for plugins */
  enableChecker?: PluginEnableChecker;
  /**
   * Runtime context for context-aware builtin manifests. When provided, each
   * builtin tool with a `resolveManifest` produces its manifest for this context
   * (trimming APIs or opting out via `null`). Omit for context-free callers
   * (e.g. UI token estimation) — they get the full static manifests.
   */
  manifestContext?: BuiltinToolResolveContext;
}

/**
 * A manifest is usable by ToolsEngine only if it has a non-empty `api` array.
 * ToolsEngine.convertManifestsToTools calls `manifest.api.map(...)` unconditionally,
 * so any entry with `api` missing / non-array will crash the whole tools build.
 * Sources that populate manifests (installed plugins, Composio, LobeHub skills, MCP)
 * have no shared schema validation, so we guard defensively at the merge point.
 */
const isValidToolManifest = (m: ToolManifest | undefined): m is ToolManifest =>
  !!m && typeof m === 'object' && Array.isArray((m as ToolManifest).api);

const dropInvalidManifests = (manifests: (ToolManifest | undefined)[], source: string) => {
  const valid: ToolManifest[] = [];
  const dropped: Array<{ identifier?: string; reason: string }> = [];

  for (const m of manifests) {
    if (isValidToolManifest(m)) {
      valid.push(m);
    } else if (m) {
      dropped.push({
        identifier: (m as { identifier?: string }).identifier,
        reason: Array.isArray((m as { api?: unknown }).api)
          ? 'unknown'
          : 'missing `api` field (expected array)',
      });
    }
  }

  if (dropped.length > 0) {
    console.warn(
      `[toolEngineering] Dropped ${dropped.length} invalid manifest(s) from ${source}:`,
      dropped,
    );
  }

  return valid;
};

/**
 * Initialize ToolsEngine with current manifest schemas and configurable options
 */
export const createToolsEngine = (config: ToolsEngineConfig = {}): ToolsEngine => {
  const { enableChecker, additionalManifests = [], defaultToolIds, manifestContext } = config;

  const toolStoreState = getToolStoreState();

  // Get custom connector manifests (user-added MCP servers). Connectors take
  // priority over plugins: any plugin sharing a connector identifier is dropped
  // so the connector (server-side execution with its stored token) wins.
  const connectorManifests = buildClientConnectorManifests(
    connectorSelectors.customConnectors(toolStoreState),
  );
  const connectorIdentifiers = new Set(connectorManifests.map((m) => m.identifier));

  // Per-connector tool permissions, keyed by connector identifier. Used to patch
  // community-MCP plugin manifests below so the user's needs_approval / disabled
  // settings surface as humanIntervention (custom connectors are handled by their
  // own manifests above; disabled is also hard-blocked at the mcp router).
  const connectorPermsByIdentifier = new Map(
    connectorSelectors
      .connectorList(toolStoreState)
      .map((c) => [c.identifier, new Map(c.tools.map((t) => [t.toolName, t.permission]))] as const),
  );

  // Get all available plugin manifests (excluding ones now covered by a connector),
  // patched with their connector tool permissions when a connector row exists.
  const pluginManifests = pluginSelectors
    .installedPluginManifestList(toolStoreState)
    .filter((m) => !connectorIdentifiers.has(m.identifier))
    .map((m) => {
      const perms = connectorPermsByIdentifier.get(m.identifier);
      return perms && perms.size > 0
        ? (patchManifestWithPermissions(
            m as any,
            perms as Map<string, ConnectorToolPermission>,
          ) as ToolManifest)
        : m;
    });

  // Get all builtin tool manifests. When a manifest context is supplied (agent
  // runtime path), context-aware tools resolve their manifest for it — trimming
  // APIs (e.g. lobe-agent hides callSubAgent in groups) or opting out via `null`.
  // Context-free callers fall back to the full static manifest.
  const builtinManifests = toolStoreState.builtinTools
    .map((tool) =>
      manifestContext && tool.resolveManifest
        ? tool.resolveManifest(manifestContext)
        : tool.manifest,
    )
    .filter((m): m is BuiltinToolManifest => !!m) as ToolManifest[];

  // Get Composio tool manifests
  const composioTools = composioStoreSelectors.composioAsLobeTools(toolStoreState);
  const composioManifests = composioTools
    .map((tool) => tool.manifest as ToolManifest)
    .filter(Boolean);

  // Get LobeHub Skill tool manifests
  const lobehubSkillTools = lobehubSkillStoreSelectors.lobehubSkillAsLobeTools(toolStoreState);
  const lobehubSkillManifests = lobehubSkillTools
    .map((tool) => tool.manifest as ToolManifest)
    .filter(Boolean);

  // Combine all manifests, dropping entries that would crash ToolsEngine.
  // Each source is filtered separately so the warning pinpoints the origin.
  const allManifests = [
    ...dropInvalidManifests(pluginManifests, 'installedPlugins'),
    ...dropInvalidManifests(builtinManifests, 'builtinTools'),
    ...dropInvalidManifests(composioManifests, 'composio'),
    ...dropInvalidManifests(lobehubSkillManifests, 'lobehubSkills'),
    ...dropInvalidManifests(connectorManifests, 'connectors'),
    ...dropInvalidManifests(additionalManifests, 'additionalManifests'),
  ];

  return new ToolsEngine({
    defaultToolIds,
    enableChecker,
    functionCallChecker: isCanUseFC,
    manifestSchemas: allManifests,
  });
};

export const createAgentToolsEngine = (
  workingModel: WorkingModel,
  /** Runtime-resolved plugin IDs (from agentConfigResolver), may include tools beyond the active agent */
  pluginIds?: string[],
  /** Conversation context for context-aware builtin manifests (scope, isSubAgent). */
  manifestContext?: BuiltinToolResolveContext,
) => {
  const searchConfig = getSearchConfig(workingModel.model, workingModel.provider);
  const agentState = getAgentStoreState();
  const userPlugins = agentSelectors.currentAgentPlugins(agentState);
  const isChatMode =
    agentChatConfigSelectors.currentChatConfig(agentState).enableAgentMode === false ||
    !isCanUseFC(workingModel.model, workingModel.provider);

  // Each entry below still respects its own runtime gate; in chat mode this
  // is the entire whitelist. `allowExplicitActivation` and user plugins /
  // `alwaysOnToolIds` are deliberately omitted in chat mode so the activator
  // can't smuggle additional tools in.
  const kbEnabled = agentSelectors.hasEnabledKnowledgeBases(agentState);
  const memoryEnabled =
    agentChatConfigSelectors.currentChatConfig(agentState).memory?.enabled ??
    settingsSelectors.memoryEnabled(useUserStore.getState());
  const webBrowsingEnabled = searchConfig.useApplicationBuiltinSearchTool;

  const chatModeRules = {
    [KnowledgeBaseManifest.identifier]: kbEnabled,
    [MemoryManifest.identifier]: memoryEnabled,
    [WebBrowsingManifest.identifier]: webBrowsingEnabled,
  };

  const agentModeRules = {
    // Runtime-resolved plugins (from agentConfigResolver for the effective agent,
    // may include sub-agent/group/page scope plugins not on the active agent)
    ...(pluginIds && Object.fromEntries(pluginIds.map((id) => [id, true]))),
    // User-selected plugins (from the active agent)
    ...Object.fromEntries(userPlugins.map((id) => [id, true])),
    // Always-on builtin tools
    ...Object.fromEntries(alwaysOnToolIds.map((id) => [id, true])),
    // System-level rules (may override user selection for specific tools)
    [CloudSandboxManifest.identifier]: agentChatConfigSelectors.isCloudSandboxEnabled(agentState),
    [KnowledgeBaseManifest.identifier]: kbEnabled,
    [LocalSystemManifest.identifier]: agentChatConfigSelectors.isLocalSystemEnabled(agentState),
    [MemoryManifest.identifier]: memoryEnabled,
    [WebBrowsingManifest.identifier]: webBrowsingEnabled,
  };

  return createToolsEngine({
    defaultToolIds: isChatMode ? chatModeAllowedToolIds : defaultToolIds,
    manifestContext,
    enableChecker: createEnableChecker({
      allowExplicitActivation: !isChatMode,
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
      rules: isChatMode ? chatModeRules : agentModeRules,
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

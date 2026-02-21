/**
 * Tools Engineering - Unified tools processing using ToolsEngine
 */
import { KnowledgeBaseManifest } from '@lobechat/builtin-tool-knowledge-base';
import { WebBrowsingManifest } from '@lobechat/builtin-tool-web-browsing';
import { isDesktop } from '@lobechat/const';
import { type PluginEnableChecker } from '@lobechat/context-engine';
import { ToolsEngine } from '@lobechat/context-engine';
import { type ChatCompletionTool, type WorkingModel } from '@lobechat/types';
import { type LobeChatPluginManifest } from '@lobehub/chat-plugin-sdk';

import { getAgentStoreState } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { getToolStoreState } from '@/store/tool';
import {
  klavisStoreSelectors,
  lobehubSkillStoreSelectors,
  pluginSelectors,
} from '@/store/tool/selectors';

import { getSearchConfig } from '../getSearchConfig';
import { isCanUseFC } from '../isCanUseFC';
import { shouldEnableTool } from '../toolFilters';

/**
 * Tools engine configuration options
 */
export interface ToolsEngineConfig {
  /** Additional manifests to include beyond the standard ones */
  additionalManifests?: LobeChatPluginManifest[];
  /** Default tool IDs that will always be added to the end of the tools list */
  defaultToolIds?: string[];
  /** Custom enable checker for plugins */
  enableChecker?: PluginEnableChecker;
}

/**
 * Initialize ToolsEngine with current manifest schemas and configurable options
 */
export const createToolsEngine = (config: ToolsEngineConfig = {}): ToolsEngine => {
  const { enableChecker, additionalManifests = [], defaultToolIds } = config;

  const toolStoreState = getToolStoreState();

  // Get all available plugin manifests
  const pluginManifests = pluginSelectors.installedPluginManifestList(toolStoreState);

  // Get all builtin tool manifests
  const builtinManifests = toolStoreState.builtinTools.map(
    (tool) => tool.manifest as LobeChatPluginManifest,
  );

  // Get Klavis tool manifests
  const klavisTools = klavisStoreSelectors.klavisAsLobeTools(toolStoreState);
  const klavisManifests = klavisTools
    .map((tool) => tool.manifest as LobeChatPluginManifest)
    .filter(Boolean);

  // Get LobeHub Skill tool manifests
  const lobehubSkillTools = lobehubSkillStoreSelectors.lobehubSkillAsLobeTools(toolStoreState);
  const lobehubSkillManifests = lobehubSkillTools
    .map((tool) => tool.manifest as LobeChatPluginManifest)
    .filter(Boolean);

  // Combine all manifests
  const allManifests = [
    ...pluginManifests,
    ...builtinManifests,
    ...klavisManifests,
    ...lobehubSkillManifests,
    ...additionalManifests,
  ];

  return new ToolsEngine({
    defaultToolIds,
    enableChecker,
    functionCallChecker: isCanUseFC,
    manifestSchemas: allManifests,
  });
};

export const createAgentToolsEngine = (workingModel: WorkingModel) =>
  createToolsEngine({
    // Add default tools based on configuration
    defaultToolIds: [WebBrowsingManifest.identifier, KnowledgeBaseManifest.identifier],
    // Create search-aware enableChecker for this request
    enableChecker: ({ pluginId }) => {
      // Check platform-specific constraints (e.g., LocalSystem desktop-only)
      if (!shouldEnableTool(pluginId)) {
        return false;
      }

      // Filter stdio MCP tools in non-desktop environments
      // stdio transport requires Electron IPC and cannot work on web
      if (!isDesktop) {
        const plugin = pluginSelectors.getInstalledPluginById(pluginId)(getToolStoreState());
        if (plugin?.customParams?.mcp?.type === 'stdio') {
          return false;
        }
      }

      // For WebBrowsingManifest, apply search logic
      if (pluginId === WebBrowsingManifest.identifier) {
        const searchConfig = getSearchConfig(workingModel.model, workingModel.provider);
        return searchConfig.useApplicationBuiltinSearchTool;
      }

      // For KnowledgeBaseManifest, only enable if knowledge is enabled
      if (pluginId === KnowledgeBaseManifest.identifier) {
        const agentState = getAgentStoreState();

        return agentSelectors.hasEnabledKnowledgeBases(agentState);
      }

      // For all other plugins, enable by default
      return true;
    },
  });

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
      model: model, // Use provided model or fallback
      provider: provider, // Use provided provider or fallback
      toolIds,
    }) || []
  );
};

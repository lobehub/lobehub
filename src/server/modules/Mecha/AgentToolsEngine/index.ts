/**
 * Server-side Agent Tools Engine
 *
 * This module provides the same functionality as the frontend `createAgentToolsEngine`,
 * but fetches data from the database instead of frontend stores.
 *
 * Key differences from frontend:
 * - Gets installed plugins from context (fetched from database)
 * - Gets model capabilities from provided function
 * - No dependency on frontend stores (useToolStore, useAgentStore, etc.)
 */
import { KnowledgeBaseManifest } from '@lobechat/builtin-tool-knowledge-base';
import { LocalSystemManifest } from '@lobechat/builtin-tool-local-system';
import { WebBrowsingManifest } from '@lobechat/builtin-tool-web-browsing';
import { type LobeToolManifest } from '@lobechat/context-engine';
import { ToolsEngine } from '@lobechat/context-engine';
import debug from 'debug';

import { builtinTools } from '@/tools';

import {
  type ServerAgentToolsContext,
  type ServerAgentToolsEngineConfig,
  type ServerCreateAgentToolsEngineParams,
} from './types';

export type {
  InstalledPlugin,
  ServerAgentToolsContext,
  ServerAgentToolsEngineConfig,
  ServerCreateAgentToolsEngineParams,
} from './types';

const log = debug('lobe-server:agent-tools-engine');

/**
 * Initialize ToolsEngine with server-side context
 *
 * This is the server-side equivalent of frontend's `createToolsEngine`
 *
 * @param context - Server context with installed plugins and model checker
 * @param config - Optional configuration
 * @returns ToolsEngine instance
 */
export const createServerToolsEngine = (
  context: ServerAgentToolsContext,
  config: ServerAgentToolsEngineConfig = {},
): ToolsEngine => {
  const { enableChecker, additionalManifests = [], defaultToolIds } = config;

  // Get plugin manifests from installed plugins (from database)
  const pluginManifests = context.installedPlugins
    .map((plugin) => plugin.manifest as LobeToolManifest)
    .filter(Boolean);

  // Get all builtin tool manifests
  const builtinManifests = builtinTools.map((tool) => tool.manifest as LobeToolManifest);

  // Combine all manifests
  const allManifests = [...pluginManifests, ...builtinManifests, ...additionalManifests];

  log(
    'Creating ToolsEngine with %d plugin manifests, %d builtin manifests, %d additional manifests',
    pluginManifests.length,
    builtinManifests.length,
    additionalManifests.length,
  );

  return new ToolsEngine({
    defaultToolIds,
    enableChecker,
    functionCallChecker: context.isModelSupportToolUse,
    manifestSchemas: allManifests,
  });
};

/**
 * Create a ToolsEngine for agent chat with server-side context
 *
 * This is the server-side equivalent of frontend's `createAgentToolsEngine`
 *
 * @param context - Server context with installed plugins and model checker
 * @param params - Agent config and model info
 * @returns ToolsEngine instance configured for the agent
 */
export const createServerAgentToolsEngine = (
  context: ServerAgentToolsContext,
  params: ServerCreateAgentToolsEngineParams,
): ToolsEngine => {
  const {
    additionalManifests,
    agentConfig,
    hasEnabledKnowledgeBases = false,
    model,
    provider,
  } = params;
  const searchMode = agentConfig.chatConfig?.searchMode ?? 'off';
  const isSearchEnabled = searchMode !== 'off';

  log(
    'Creating agent tools engine for model=%s, provider=%s, searchMode=%s, additionalManifests=%d',
    model,
    provider,
    searchMode,
    additionalManifests?.length ?? 0,
  );

  return createServerToolsEngine(context, {
    // Pass additional manifests (e.g., LobeHub Skills)
    additionalManifests,
    // Add default tools based on configuration
    defaultToolIds: [WebBrowsingManifest.identifier, KnowledgeBaseManifest.identifier],
    // Create search-aware enableChecker for this request
    enableChecker: ({ pluginId }) => {
      // Filter LocalSystem tool on server (it's desktop-only)
      if (pluginId === LocalSystemManifest.identifier) {
        return false;
      }

      // For WebBrowsingManifest, apply search logic
      if (pluginId === WebBrowsingManifest.identifier) {
        // TODO: Check model builtin search capability when needed
        return isSearchEnabled;
      }

      // For KnowledgeBaseManifest, only enable if knowledge is enabled
      if (pluginId === KnowledgeBaseManifest.identifier) {
        return hasEnabledKnowledgeBases;
      }

      // For all other plugins, enable by default
      return true;
    },
  });
};

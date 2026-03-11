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
import { MemoryManifest } from '@lobechat/builtin-tool-memory';
import { RemoteDeviceManifest } from '@lobechat/builtin-tool-remote-device';
import { WebBrowsingManifest } from '@lobechat/builtin-tool-web-browsing';
import { builtinTools, defaultToolIds } from '@lobechat/builtin-tools';
import { createEnableChecker, type LobeToolManifest } from '@lobechat/context-engine';
import { ToolsEngine } from '@lobechat/context-engine';
import debug from 'debug';

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
    deviceContext,
    globalMemoryEnabled = false,
    hasEnabledKnowledgeBases = false,
    model,
    provider,
  } = params;
  const searchMode = agentConfig.chatConfig?.searchMode ?? 'auto';
  const isSearchEnabled = searchMode !== 'off';

  log(
    'Creating agent tools engine for model=%s, provider=%s, searchMode=%s, additionalManifests=%d, deviceGateway=%s',
    model,
    provider,
    searchMode,
    additionalManifests?.length ?? 0,
    !!deviceContext?.gatewayConfigured,
  );

  return createServerToolsEngine(context, {
    // Pass additional manifests (e.g., LobeHub Skills)
    additionalManifests,
    // Add default tools based on configuration
    defaultToolIds,
    enableChecker: createEnableChecker({
      rules: {
        [KnowledgeBaseManifest.identifier]: hasEnabledKnowledgeBases,
        [LocalSystemManifest.identifier]:
          !!deviceContext?.gatewayConfigured && !!deviceContext?.deviceOnline,
        [MemoryManifest.identifier]: globalMemoryEnabled,
        [RemoteDeviceManifest.identifier]: !!deviceContext?.gatewayConfigured,
        [WebBrowsingManifest.identifier]: isSearchEnabled,
      },
    }),
  });
};

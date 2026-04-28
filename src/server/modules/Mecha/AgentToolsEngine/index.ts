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
import { AgentDocumentsManifest } from '@lobechat/builtin-tool-agent-documents';
import { CloudSandboxManifest } from '@lobechat/builtin-tool-cloud-sandbox';
import { KnowledgeBaseManifest } from '@lobechat/builtin-tool-knowledge-base';
import { LocalSystemManifest } from '@lobechat/builtin-tool-local-system';
import { MemoryManifest } from '@lobechat/builtin-tool-memory';
import { MessageManifest } from '@lobechat/builtin-tool-message';
import { RemoteDeviceManifest } from '@lobechat/builtin-tool-remote-device';
import { WebBrowsingManifest } from '@lobechat/builtin-tool-web-browsing';
import { alwaysOnToolIds, builtinTools, defaultToolIds } from '@lobechat/builtin-tools';
import { createEnableChecker, type LobeToolManifest } from '@lobechat/context-engine';
import { ToolsEngine } from '@lobechat/context-engine';
import { type RuntimeEnvMode, type RuntimePlatform } from '@lobechat/types';
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
    clientRuntime,
    deviceContext,
    globalMemoryEnabled = false,
    hasAgentDocuments = false,
    hasEnabledKnowledgeBases = false,
    isBotConversation = false,
    model,
    provider,
  } = params;

  // ─── Tool-dispatch capability flags ───
  //
  // Two orthogonal signals control whether client-side tools can run.
  //
  //  1. `hasClientExecutor` — the caller itself is an Electron desktop
  //     client and can receive `tool_execute` events over the Agent
  //     Gateway WebSocket (Phase 6.4).
  //  2. `hasDeviceProxy` — the server has a device-proxy configured that
  //     can tunnel commands to a *separately registered* desktop device
  //     (legacy Remote Device flow).
  //
  // Either, both, or neither can be true independently.
  const hasClientExecutor = clientRuntime === 'desktop';
  const hasDeviceProxy = !!deviceContext?.gatewayConfigured;

  // ─── Platform / runtime mode ───
  //
  // `platform` is a property of the caller, not of the server. Prefer the
  // explicit `clientRuntime` signal; fall back to treating a server with
  // a configured device-proxy as desktop for callers that don't yet send
  // `clientRuntime` (backwards compat).
  const platform: RuntimePlatform = clientRuntime ?? (hasDeviceProxy ? 'desktop' : 'web');

  // User-configured runtime mode for the current platform, with a
  // platform-appropriate default when unset.
  const runtimeMode: RuntimeEnvMode =
    agentConfig.chatConfig?.runtimeEnv?.runtimeMode?.[platform] ??
    (platform === 'desktop' ? 'local' : 'none');

  const searchMode = agentConfig.chatConfig?.searchMode ?? 'auto';
  const isSearchEnabled = searchMode !== 'off';

  log(
    'Creating agent tools engine model=%s provider=%s searchMode=%s platform=%s runtimeMode=%s additionalManifests=%d hasClientExecutor=%s hasDeviceProxy=%s',
    model,
    provider,
    searchMode,
    platform,
    runtimeMode,
    additionalManifests?.length ?? 0,
    hasClientExecutor,
    hasDeviceProxy,
  );

  return createServerToolsEngine(context, {
    // Pass additional manifests (e.g., LobeHub Skills)
    additionalManifests,
    // Add default tools based on configuration
    defaultToolIds,
    enableChecker: createEnableChecker({
      // Allow lobe-activator to dynamically enable tools at runtime (e.g., lobe-creds, lobe-cron)
      allowExplicitActivation: true,
      rules: {
        // User-selected plugins
        ...Object.fromEntries((agentConfig.plugins ?? []).map((id) => [id, true])),
        // Always-on builtin tools
        ...Object.fromEntries(alwaysOnToolIds.map((id) => [id, true])),
        // System-level rules (may override user selection for specific tools)
        [CloudSandboxManifest.identifier]: runtimeMode === 'cloud',
        [KnowledgeBaseManifest.identifier]: hasEnabledKnowledgeBases,
        // Local-system: user must have opted into local runtime on this
        // platform (`runtimeMode === 'local'`), AND one execution channel
        // must exist:
        //  - `hasClientExecutor` — Phase 6.4 dispatch over the Agent Gateway
        //    WS that this request is already riding on; no extra server-side
        //    prerequisite needed;
        //  - legacy device-proxy with an online & auto-activated device.
        [LocalSystemManifest.identifier]:
          runtimeMode === 'local' &&
          (hasClientExecutor ||
            (hasDeviceProxy && !!deviceContext?.deviceOnline && !!deviceContext?.autoActivated)),
        [MemoryManifest.identifier]: globalMemoryEnabled,
        // Only auto-enable in bot conversations; otherwise let user's plugin selection take effect
        ...(isBotConversation && { [MessageManifest.identifier]: true }),
        // Remote-device proxy: shown only when the server has a proxy but
        // no specific device is auto-activated yet (user must pick). When
        // the caller itself can execute `executor: 'client'` tools, the
        // proxy is redundant — local-system goes directly to the caller.
        //
        // Bot conversations (Telegram/Discord/Slack/…) never have a
        // client-executor by definition, which would otherwise make
        // RemoteDevice permanently auto-enabled there. Its systemRole
        // tells the model to "inform the user to open their desktop
        // application" when no device is online, overriding the
        // Activator's own guidance and blocking discovery of cloud tools
        // (e.g. Klavis Gmail). Keep RemoteDevice discoverable via the
        // Activator in bot flows, but don't inject it by default.
        [RemoteDeviceManifest.identifier]:
          hasDeviceProxy &&
          !deviceContext?.autoActivated &&
          !hasClientExecutor &&
          !isBotConversation,
        [AgentDocumentsManifest.identifier]: hasAgentDocuments,
        [WebBrowsingManifest.identifier]: isSearchEnabled,
      },
    }),
  });
};

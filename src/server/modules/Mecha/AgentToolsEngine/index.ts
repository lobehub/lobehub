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
import {
  alwaysOnToolIds,
  builtinTools,
  chatModeAllowedToolIds,
  defaultToolIds,
} from '@lobechat/builtin-tools';
import { createEnableChecker, type LobeToolManifest } from '@lobechat/context-engine';
import { ToolsEngine } from '@lobechat/context-engine';
import { type RuntimeEnvMode, type RuntimePlatform } from '@lobechat/types';
import debug from 'debug';

import {
  buildAllowedBuiltinTools,
  DEVICE_TOOL_IDENTIFIERS,
} from '@/server/services/aiAgent/deviceToolRegistry';

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
  const {
    enableChecker,
    additionalManifests = [],
    builtinTools: builtinToolsOverride = builtinTools,
    defaultToolIds,
    excludeIdentifiers,
  } = config;

  // Get plugin manifests from installed plugins (from database)
  const pluginManifests = context.installedPlugins
    .map((plugin) => plugin.manifest as LobeToolManifest)
    .filter(Boolean);

  // Get builtin tool manifests from the (possibly pre-filtered) list. The
  // filter is one half of the hard wall keeping device tools out of an
  // external bot sender's manifestSchemas — see `buildAllowedBuiltinTools`
  // and . The enableChecker rules below are defense-in-depth
  // because `allowExplicitActivation` lets activator-driven activation
  // bypass them.
  const builtinManifests = builtinToolsOverride.map((tool) => tool.manifest as LobeToolManifest);

  // Combine all manifests, then drop anything whose identifier the caller
  // has explicitly forbidden for this turn. The post-merge filter closes
  // the second half of the wall: an installed plugin or a
  // Skill/Klavis manifest claiming `lobe-remote-device` would otherwise
  // slip through `buildAllowedBuiltinTools` (which only touches the
  // builtin source).
  const combinedManifests = [...pluginManifests, ...builtinManifests, ...additionalManifests];
  const allManifests = excludeIdentifiers
    ? combinedManifests.filter((m) => !excludeIdentifiers.has(m.identifier))
    : combinedManifests;

  log(
    'Creating ToolsEngine with %d plugin manifests, %d builtin manifests, %d additional manifests, %d excluded',
    pluginManifests.length,
    builtinManifests.length,
    additionalManifests.length,
    combinedManifests.length - allManifests.length,
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
    canUseDevice = false,
    deviceContext,
    disableLocalSystem = false,
    globalMemoryEnabled = false,
    hasAgentDocuments = false,
    hasEnabledKnowledgeBases = false,
    isBotConversation = false,
    model,
    provider,
  } = params;

  // Tools that need a user-side execution target (local-system, stdio MCP)
  // run on a device registered with the device-gateway. Desktop, CLI, and
  // bot/IM callers all converge on this single path; the previous Phase 6.4
  // `clientRuntime === 'desktop'` short-circuit (Agent Gateway WS dispatch
  // back to the caller) is removed.
  const hasDeviceProxy = !!deviceContext?.gatewayConfigured;

  // Platform key is used only to look up the user's per-platform
  // `runtimeMode` preference. A server configured with a device-gateway is
  // serving desktop-class users; otherwise the caller is treated as web.
  const platform: RuntimePlatform = hasDeviceProxy ? 'desktop' : 'web';

  // User-configured runtime mode for the current platform, with a
  // platform-appropriate default when unset.
  const runtimeMode: RuntimeEnvMode =
    agentConfig.chatConfig?.runtimeEnv?.runtimeMode?.[platform] ??
    (platform === 'desktop' ? 'local' : 'none');

  const searchMode = agentConfig.chatConfig?.searchMode ?? 'auto';
  const isSearchEnabled = searchMode !== 'off';
  // Tool mode: explicit `toolMode` wins; otherwise derive from `enableAgentMode`
  // (undefined = agent). `custom` = toolset is exactly the agent's plugins.
  const toolMode: 'agent' | 'chat' | 'custom' =
    agentConfig.chatConfig?.toolMode ??
    (agentConfig.chatConfig?.enableAgentMode === false ? 'chat' : 'agent');
  const isChatMode = toolMode === 'chat';
  const isCustomMode = toolMode === 'custom';

  log(
    'Creating agent tools engine model=%s provider=%s searchMode=%s platform=%s runtimeMode=%s additionalManifests=%d hasDeviceProxy=%s canUseDevice=%s isChatMode=%s',
    model,
    provider,
    searchMode,
    platform,
    runtimeMode,
    additionalManifests?.length ?? 0,
    hasDeviceProxy,
    canUseDevice,
    isChatMode,
  );

  // Chat mode: strict outer whitelist. Drop user plugins, alwaysOn tools, and
  // every other runtime-managed rule. Each entry below still passes through
  // its own runtime gate (KB needs enabled bases, memory needs global toggle,
  // web-browsing needs search on). `allowExplicitActivation` is off so the
  // activator can't smuggle anything else in.
  const chatModeRules = {
    [KnowledgeBaseManifest.identifier]: hasEnabledKnowledgeBases,
    [MemoryManifest.identifier]: globalMemoryEnabled,
    [WebBrowsingManifest.identifier]: isSearchEnabled,
  };

  // Custom mode: the tool set is EXACTLY the agent's declared plugins — no
  // alwaysOn tools, no default/runtime-managed injection, no activator. Used by
  // focused builtin sub-agents (e.g. the verify agent, which mounts only its
  // writeback tool) that need a precise, self-configured toolset.
  const customModeRules = Object.fromEntries((agentConfig.plugins ?? []).map((id) => [id, true]));

  const agentModeRules = {
    // User-selected plugins
    ...Object.fromEntries((agentConfig.plugins ?? []).map((id) => [id, true])),
    // Always-on builtin tools
    ...Object.fromEntries(alwaysOnToolIds.map((id) => [id, true])),
    // System-level rules (may override user selection for specific tools)
    [CloudSandboxManifest.identifier]: runtimeMode === 'cloud',
    [KnowledgeBaseManifest.identifier]: hasEnabledKnowledgeBases,
    // Local-system: gated by `canUseDevice` (resolveDeviceAccessPolicy)
    // first — keeps external bot senders out before runtime checks even
    // run. Then user must have opted into local runtime on this platform
    // (`runtimeMode === 'local'`) AND have an online, auto-activated
    // device registered with the device-gateway.
    [LocalSystemManifest.identifier]:
      canUseDevice &&
      !disableLocalSystem &&
      runtimeMode === 'local' &&
      hasDeviceProxy &&
      !!deviceContext?.deviceOnline &&
      !!deviceContext?.autoActivated,
    [MemoryManifest.identifier]: globalMemoryEnabled,
    // Only auto-enable in bot conversations; otherwise let user's plugin selection take effect
    ...(isBotConversation && { [MessageManifest.identifier]: true }),
    // Remote-device proxy: shown only when the server has a proxy but
    // no specific device is auto-activated yet (user must pick).
    //
    // `canUseDevice` is the first short-circuit: external bot senders
    // (and unconfigured bot owners) never reach the proxy, both because
    // it would let them poke at the owner's machine AND because its
    // systemRole would otherwise leak the device list into the LLM
    // context — see the gated injection in `aiAgent.execAgent`.
    [RemoteDeviceManifest.identifier]:
      canUseDevice && hasDeviceProxy && !deviceContext?.autoActivated,
    [AgentDocumentsManifest.identifier]: hasAgentDocuments,
    [WebBrowsingManifest.identifier]: isSearchEnabled,
  };

  return createServerToolsEngine(context, {
    // Pass additional manifests (e.g., LobeHub Skills)
    additionalManifests,
    // Physically drop device-tool manifests for turns whose access policy
    // denies them. Without this filter, `lobe-activator`'s explicit
    // activation could resolve the manifest and bypass the rule-layer
    // gates below ().
    builtinTools: buildAllowedBuiltinTools({ canUseDevice, disableLocalSystem }),
    // Add default tools based on configuration. Custom mode = exactly the
    // agent's plugins; chat mode = strict allow-list; agent mode = full defaults.
    defaultToolIds: isCustomMode
      ? (agentConfig.plugins ?? [])
      : isChatMode
        ? chatModeAllowedToolIds
        : defaultToolIds,
    // Post-merge wall: a plugin or Skill/Klavis manifest claiming a
    // device identifier survives `buildAllowedBuiltinTools` (which only
    // filters the builtin source). Excluding the identifiers here drops
    // them from the combined `manifestSchemas` so the activator cannot
    // resolve them regardless of which manifest source declared them.
    excludeIdentifiers: canUseDevice ? undefined : DEVICE_TOOL_IDENTIFIERS,
    enableChecker: createEnableChecker({
      // Allow lobe-activator to dynamically enable tools at runtime (e.g., lobe-creds, lobe-cron).
      // Only in agent mode; chat/custom modes can't let the activator bypass their fixed set.
      allowExplicitActivation: toolMode === 'agent',
      rules: isCustomMode ? customModeRules : isChatMode ? chatModeRules : agentModeRules,
    }),
  });
};

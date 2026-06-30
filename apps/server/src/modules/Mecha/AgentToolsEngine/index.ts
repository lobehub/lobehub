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
import { BrowserManifest } from '@lobechat/builtin-tool-browser';
import { CloudSandboxManifest } from '@lobechat/builtin-tool-cloud-sandbox';
import { ImageGenerationManifest } from '@lobechat/builtin-tool-image-generation';
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
  groupSupervisorToolIds,
} from '@lobechat/builtin-tools';
import { createEnableChecker, type LobeToolManifest } from '@lobechat/context-engine';
import { ToolsEngine } from '@lobechat/context-engine';
import {
  type BuiltinToolManifest,
  type RuntimeEnvMode,
  type RuntimePlatform,
} from '@lobechat/types';
import debug from 'debug';

import {
  executionTargetToRuntimeMode,
  isDeviceLockedPlan,
  resolveExecutionTarget,
  resolveToolMode,
} from '@/helpers/executionTarget';
import {
  buildAllowedBuiltinTools,
  DEVICE_TOOL_IDENTIFIERS,
  REMOTE_DEVICE_TOOL_IDENTIFIERS,
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
    manifestContext,
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
  //
  // When a manifest context is supplied (agent runtime path), context-aware
  // tools resolve their manifest for it — trimming APIs (e.g. lobe-agent hides
  // callSubAgent inside a sub-agent / group, both list AND systemRole) or opting
  // out entirely via `null`. This MUST mirror the frontend `createToolsEngine`:
  // a sub-agent run server-side that skipped this would still be handed
  // `callSubAgent`, letting the model recurse into nested sub-agents that the
  // runtime then rejects — a dead loop that ends in the inactivity watchdog.
  const builtinManifests = builtinToolsOverride
    .map((tool) =>
      manifestContext && tool.resolveManifest
        ? tool.resolveManifest(manifestContext)
        : tool.manifest,
    )
    .filter((m): m is BuiltinToolManifest => !!m) as LobeToolManifest[];

  // Combine all manifests, then drop anything whose identifier the caller
  // has explicitly forbidden for this turn. The post-merge filter closes
  // the second half of the wall: an installed plugin or a
  // Skill/Composio manifest claiming `lobe-remote-device` would otherwise
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
    disabledPluginIds = [],
    executionPlan,
    globalMemoryEnabled = false,
    hasEnabledKnowledgeBases = false,
    isBotConversation = false,
    isGroupSupervisor = false,
    manifestContext,
    model,
    modelAbilities,
    provider,
  } = params;

  // Tools that need a user-side execution target (local-system, stdio MCP)
  // run on a device registered with the device-gateway. Desktop, CLI, and
  // bot/IM callers all converge on this single path; the previous Phase 6.4
  // `clientRuntime === 'desktop'` short-circuit (Agent Gateway WS dispatch
  // back to the caller) is removed.
  const hasDeviceProxy = !!deviceContext?.gatewayConfigured;

  // A server configured with a device-gateway is serving desktop-class users
  // (the unset-target default resolves to `local`); otherwise the caller is
  // treated as web.
  const platform: RuntimePlatform = hasDeviceProxy ? 'desktop' : 'web';

  // Tool gate derived from the run's resolved execution plan (sandbox → cloud
  // tools, local → local-system tools, device → gateway). Callers that don't
  // resolve a plan (focused sub-agent engines) fall back to deriving the
  // effective target from agencyConfig.
  const executionTarget =
    executionPlan?.target ??
    resolveExecutionTarget(agentConfig.agencyConfig, {
      clientExecutionAvailable: platform === 'desktop',
    });
  const runtimeMode: RuntimeEnvMode = executionTargetToRuntimeMode(executionTarget);
  // Device tools (local-system, remote-device proxy) only exist for
  // device-capable targets. `none` means NO device — the proxy that could
  // activate one mid-run must not be offered either; `sandbox` and devices
  // are mutually exclusive.
  const deviceCapable = executionTarget === 'local' || executionTarget === 'device';
  // The run is locked to ONE device (routed, or explicitly bound but
  // offline): there is no device decision left, so the remote-device picker
  // must not exist — physically, not just rule-disabled, because
  // `allowExplicitActivation` lets activator-driven activation bypass the
  // rule gates. Prefer the resolved plan; callers without one (focused
  // sub-agent engines) fall back to the raw device context with the same
  // semantics.
  const deviceLocked = executionPlan
    ? isDeviceLockedPlan(executionPlan)
    : !!deviceContext?.autoActivated || !!deviceContext?.boundDeviceId;

  const searchMode = agentConfig.chatConfig?.searchMode ?? 'auto';
  const isSearchEnabled = searchMode !== 'off';
  const imageGenerationEnabled =
    context.isModelSupportToolUse(model, provider) && !modelAbilities?.imageOutput;
  // Tool mode: explicit `toolMode` wins; otherwise derive from `enableAgentMode`
  // (undefined = agent). `custom` = toolset is exactly the agent's plugins.
  const toolMode = resolveToolMode(agentConfig.chatConfig ?? undefined);
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
    // Example: Claude can call tools but lacks native imageOutput, so expose the
    // image-generation fallback; image-output models should use their native path.
    [ImageGenerationManifest.identifier]: imageGenerationEnabled,
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
    // Local-system: the user must have opted into local runtime
    // (`runtimeMode === 'local'`) AND have an online, auto-activated device
    // registered with the device-gateway. Access policy (external bot
    // senders) is enforced upstream: `resolveExecutionPlan` degrades denied
    // targets to `none`, and `buildAllowedBuiltinTools` +
    // `excludeIdentifiers` physically drop the manifest for
    // `canUseDevice=false` turns.
    [LocalSystemManifest.identifier]:
      !disableLocalSystem &&
      runtimeMode === 'local' &&
      hasDeviceProxy &&
      !!deviceContext?.deviceOnline &&
      !!deviceContext?.autoActivated,
    // Browser drives the device's in-app browser — same device gate as
    // local-system: local runtime routed to an online, auto-activated device.
    [BrowserManifest.identifier]:
      runtimeMode === 'local' &&
      hasDeviceProxy &&
      !!deviceContext?.deviceOnline &&
      !!deviceContext?.autoActivated,
    [MemoryManifest.identifier]: globalMemoryEnabled,
    // Only auto-enable in bot conversations; otherwise let user's plugin selection take effect
    ...(isBotConversation && { [MessageManifest.identifier]: true }),
    // Group supervisor: enable the orchestration toolset (see
    // `groupSupervisorToolIds`). The same list also feeds the candidate set
    // below, so the bundle has a single source of truth.
    ...(isGroupSupervisor && Object.fromEntries(groupSupervisorToolIds.map((id) => [id, true]))),
    // Remote-device proxy: shown only for device-capable targets when the
    // server has a proxy AND the run is not already locked to a device
    // (routed, or explicitly bound but offline — a bound-offline run stays
    // unrouted until that device comes back, rather than silently hopping
    // elsewhere). This rule is defense-in-depth: the authoritative wall is
    // physical (`buildAllowedBuiltinTools` + `excludeIdentifiers` below drop
    // the manifest for locked turns), since explicit activation bypasses
    // rules. External bot senders never reach it either way: the plan
    // degrades denied targets to `none` (→ not deviceCapable) and the
    // physical walls drop it for `canUseDevice=false` turns.
    [RemoteDeviceManifest.identifier]: deviceCapable && hasDeviceProxy && !deviceLocked,
    [WebBrowsingManifest.identifier]: isSearchEnabled,
  };

  const excludedIdentifiers = new Set(disabledPluginIds);
  if (!canUseDevice) {
    for (const identifier of DEVICE_TOOL_IDENTIFIERS) excludedIdentifiers.add(identifier);
  } else if (deviceLocked) {
    for (const identifier of REMOTE_DEVICE_TOOL_IDENTIFIERS) excludedIdentifiers.add(identifier);
  }

  return createServerToolsEngine(context, {
    // Pass additional manifests (e.g., LobeHub Skills)
    additionalManifests,
    // Physically drop device-tool manifests for turns whose access policy
    // denies them. Without this filter, `lobe-activator`'s explicit
    // activation could resolve the manifest and bypass the rule-layer
    // gates below ().
    builtinTools: buildAllowedBuiltinTools({ canUseDevice, deviceLocked, disableLocalSystem }),
    // Add default tools based on configuration. Custom mode = exactly the
    // agent's plugins; chat mode = strict allow-list; agent mode = full defaults.
    // Agent mode: the supervisor's orchestration tools are neither in the
    // agent's plugins nor in `defaultToolIds`, so add them to the candidate set
    // here (the `agentModeRules` above then enable them). Enabling a tool that
    // isn't a candidate is a no-op — the checker only filters
    // `union(toolIds, defaultToolIds)`.
    defaultToolIds: isCustomMode
      ? (agentConfig.plugins ?? [])
      : isChatMode
        ? chatModeAllowedToolIds
        : [...defaultToolIds, ...(isGroupSupervisor ? groupSupervisorToolIds : [])],
    // Post-merge wall: a plugin or Skill/Composio manifest claiming a
    // device identifier survives `buildAllowedBuiltinTools` (which only
    // filters the builtin source). Excluding the identifiers here drops
    // them from the combined `manifestSchemas` so the activator cannot
    // resolve them regardless of which manifest source declared them.
    // Locked turns exclude the remote-device picker only (local-system
    // stays for the routed device).
    excludeIdentifiers: excludedIdentifiers.size > 0 ? excludedIdentifiers : undefined,
    // Conversation context for context-aware builtin manifests (scope /
    // isSubAgent), e.g. hiding lobe-agent's callSubAgent in sub-agent / group runs.
    manifestContext,
    enableChecker: createEnableChecker({
      // Allow lobe-activator to dynamically enable tools at runtime (e.g., lobe-creds, lobe-cron).
      // Only in agent mode; chat/custom modes can't let the activator bypass their fixed set.
      allowExplicitActivation: toolMode === 'agent',
      rules: isCustomMode ? customModeRules : isChatMode ? chatModeRules : agentModeRules,
    }),
  });
};

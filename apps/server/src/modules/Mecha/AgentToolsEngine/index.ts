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
import { builtinTools } from '@lobechat/builtin-tools';
import { createEnableChecker, type LobeToolManifest } from '@lobechat/context-engine';
import { ToolsEngine } from '@lobechat/context-engine';
import { assembleManifestPool, resolveToolRules } from '@lobechat/mecha';
import { type RuntimePlatform } from '@lobechat/types';
import debug from 'debug';

import { isDeviceLockedPlan, resolveExecutionTarget } from '@/helpers/executionTarget';
import { buildAllowedBuiltinTools } from '@/server/services/aiAgent/deviceToolRegistry';

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

  // The pool rules (connector precedence, context-aware builtins, invalid
  // manifest guard, exclusion from every source) are shared with the
  // browser; the builtin list arrives pre-filtered by the device walls and
  // `excludeIdentifiers` closes the second half of that wall for the other
  // sources.
  const { manifests } = assembleManifestPool(
    {
      additional: additionalManifests,
      builtinTools: builtinToolsOverride,
      installedPlugins: context.installedPlugins.map(
        (plugin) => plugin.manifest as LobeToolManifest | undefined,
      ),
    },
    { excludedIdentifiers: excludeIdentifiers, manifestContext },
  );

  log(
    'Creating ToolsEngine with %d manifests (%d installed plugins, %d additional, %d excluded)',
    manifests.length,
    context.installedPlugins.length,
    additionalManifests.length,
    excludeIdentifiers?.size ?? 0,
  );

  return new ToolsEngine({
    defaultToolIds,
    enableChecker,
    functionCallChecker: context.isModelSupportToolUse,
    manifestSchemas: manifests,
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
    useApplicationBuiltinSearchTool,
  } = params;

  // Tools that need a user-side execution target (local-system, stdio MCP)
  // run on a device registered with the device-gateway. Desktop, CLI and
  // bot/IM callers all converge on this single path.
  const hasDeviceProxy = !!deviceContext?.gatewayConfigured;
  // A server configured with a device-gateway is serving desktop-class users
  // (the unset-target default resolves to `local`); otherwise web.
  const platform: RuntimePlatform = hasDeviceProxy ? 'desktop' : 'web';
  // Prefer the run's resolved plan; callers without one (focused sub-agent
  // engines) derive the effective target from agencyConfig.
  const executionTarget =
    executionPlan?.target ??
    resolveExecutionTarget(agentConfig.agencyConfig, {
      clientExecutionAvailable: platform === 'desktop',
    });
  const deviceLocked = executionPlan
    ? isDeviceLockedPlan(executionPlan)
    : !!deviceContext?.autoActivated || !!deviceContext?.boundDeviceId;

  // The rules — mode, per-tool enablement, defaults and the device walls —
  // are shared with the browser through `@lobechat/mecha`; this engine only
  // assembles the server's facts.
  const resolved = resolveToolRules({
    agent: { chatConfig: agentConfig.chatConfig, plugins: agentConfig.plugins },
    // Gateway facts exist only behind a gateway: without one nothing can
    // dispatch to a device, so the picker never exists. The policy / plan
    // walls apply either way.
    device: hasDeviceProxy
      ? {
          autoActivated: deviceContext?.autoActivated,
          deviceOnline: deviceContext?.deviceOnline,
          supportedTools: deviceContext?.supportedTools ?? [],
        }
      : undefined,
    deviceAccess: { canUseDevice, deviceLocked },
    disableLocalSystem,
    disabledPluginIds,
    executionTarget,
    hasEnabledKnowledgeBases,
    isBotConversation,
    isGroupSupervisor,
    // Local tools reach a machine only through an online, auto-activated
    // device on the gateway; access policy is enforced upstream by the plan.
    localExecutionReady:
      hasDeviceProxy && !!deviceContext?.deviceOnline && !!deviceContext?.autoActivated,
    memoryEnabled: globalMemoryEnabled,
    model: {
      canUseFC: context.isModelSupportToolUse(model, provider),
      hasImageOutput: !!modelAbilities?.imageOutput,
    },
    useApplicationBuiltinSearchTool,
  });

  log(
    'Creating agent tools engine model=%s provider=%s platform=%s runtimeMode=%s toolMode=%s additionalManifests=%d hasDeviceProxy=%s canUseDevice=%s',
    model,
    provider,
    platform,
    resolved.runtimeMode,
    resolved.toolMode,
    additionalManifests?.length ?? 0,
    hasDeviceProxy,
    canUseDevice,
  );

  return createServerToolsEngine(context, {
    additionalManifests,
    // Physically drop device-tool manifests the walls deny: explicit
    // activation could otherwise resolve them past the rule gates.
    builtinTools: buildAllowedBuiltinTools({
      canUseDevice,
      deviceLocked,
      disableLocalSystem,
      supportedDeviceTools: hasDeviceProxy ? (deviceContext?.supportedTools ?? []) : undefined,
    }),
    defaultToolIds: resolved.defaultToolIds,
    // Post-merge wall: a plugin or Skill/Composio manifest claiming a device
    // identifier survives the builtin filter; excluding it here drops it from
    // every source.
    excludeIdentifiers:
      resolved.excludedIdentifiers.size > 0 ? resolved.excludedIdentifiers : undefined,
    manifestContext,
    enableChecker: createEnableChecker({
      allowExplicitActivation: resolved.allowExplicitActivation,
      rules: resolved.rules,
    }),
  });
};

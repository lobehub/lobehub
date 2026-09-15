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
import { resolveToolRules } from '@lobechat/mecha';
import { type BuiltinToolManifest, type RuntimePlatform } from '@lobechat/types';
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
 * A manifest is usable by ToolsEngine only if it has an `api` array.
 * ToolsEngine.convertManifestsToTools calls `manifest.api.map(...)`
 * unconditionally, so any entry with `api` missing / non-array crashes the
 * whole tools build — and with it every execAgent call of the affected user.
 * Installed-plugin manifests come straight from a DB jsonb column with no
 * schema validation, so guard defensively at the merge point. Mirrors the
 * frontend `dropInvalidManifests` in `src/helpers/toolEngineering`.
 */
const isValidToolManifest = (m: LobeToolManifest | undefined): m is LobeToolManifest =>
  !!m && typeof m === 'object' && Array.isArray((m as LobeToolManifest).api);

const dropInvalidManifests = (
  manifests: (LobeToolManifest | undefined)[],
  source: string,
): LobeToolManifest[] => {
  const valid: LobeToolManifest[] = [];
  const dropped: Array<{ identifier?: string; reason: string }> = [];

  for (const m of manifests) {
    if (isValidToolManifest(m)) {
      valid.push(m);
    } else if (m) {
      dropped.push({
        identifier: (m as { identifier?: string }).identifier,
        reason: 'missing `api` field (expected array)',
      });
    }
  }

  if (dropped.length > 0) {
    console.warn(
      `[AgentToolsEngine] Dropped ${dropped.length} invalid manifest(s) from ${source}:`,
      dropped,
    );
  }

  return valid;
};

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
  const pluginManifests = dropInvalidManifests(
    context.installedPlugins.map((plugin) => plugin.manifest as LobeToolManifest | undefined),
    'installedPlugins',
  );

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
  const combinedManifests = [
    ...pluginManifests,
    ...builtinManifests,
    ...dropInvalidManifests(additionalManifests, 'additionalManifests'),
  ];
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
    // Device facts exist only behind a gateway; a plain server run has no
    // device and therefore no device picker.
    device: hasDeviceProxy
      ? {
          autoActivated: deviceContext?.autoActivated,
          canUseDevice,
          deviceLocked,
          deviceOnline: deviceContext?.deviceOnline,
          supportedTools: deviceContext?.supportedTools ?? [],
        }
      : { canUseDevice, deviceLocked },
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

import { AuvManifest } from '@lobechat/builtin-tool-auv';
import { CloudSandboxManifest } from '@lobechat/builtin-tool-cloud-sandbox';
import { LocalSystemManifest } from '@lobechat/builtin-tool-local-system';
import { RemoteDeviceManifest } from '@lobechat/builtin-tool-remote-device';
import type { LobeToolManifest } from '@lobechat/context-engine';
import {
  type DeviceExecutionTarget,
  executionTargetToRuntimeMode,
  type LobeBuiltinTool,
  type ToolExecutor,
  type ToolSource,
} from '@lobechat/types';

import { isDeviceToolIdentifier, REMOTE_DEVICE_TOOL_IDENTIFIERS } from './deviceTools';
import type { ToolRuleDeviceAccess, ToolRuleDeviceFacts } from './types';

export interface InvocationToolIdsRequest {
  /** The run's candidate plugin identifiers (pinned, additional, selected, mention-driven). */
  agentPlugins: readonly string[];
  composioIds?: readonly string[];
  connectorIds?: readonly string[];
  disableLocalSystem?: boolean;
  /** An exact toolset (verify agent, goal supervisor): nothing is added. */
  exclusivePluginIds?: readonly string[];
  lobehubSkillIds?: readonly string[];
}

/**
 * The identifiers handed to the tools engine for this run. Beyond the
 * agent's own candidates, every device tool and every connector-family
 * manifest is a candidate — the enable rules decide, and a tool that is not
 * a candidate can never be enabled.
 */
export const resolveInvocationToolIds = (request: InvocationToolIdsRequest): string[] => {
  if (request.exclusivePluginIds) return [...request.agentPlugins];
  return [
    ...new Set([
      ...request.agentPlugins,
      ...(request.disableLocalSystem
        ? []
        : [LocalSystemManifest.identifier, AuvManifest.identifier]),
      RemoteDeviceManifest.identifier,
      ...(request.lobehubSkillIds ?? []),
      ...(request.composioIds ?? []),
      ...(request.connectorIds ?? []),
    ]),
  ];
};

export interface DiscoveryPoolRequest {
  /** Builtin tools after the device walls, with their `discoverable` flag. */
  builtinTools: readonly Pick<LobeBuiltinTool, 'discoverable' | 'identifier' | 'manifest'>[];
  /** Disabled-filtered Composio manifests. */
  composio?: readonly LobeToolManifest[];
  /** Gateway device facts; absent without a gateway. */
  device?: Pick<ToolRuleDeviceFacts, 'supportedTools'>;
  deviceAccess?: ToolRuleDeviceAccess;
  /**
   * The run may still reach a device: routed, or device-targeted but not
   * routed yet (the picker is exactly what resolves that). Taken from the
   * execution plan's kind, not from the target — an `auto` run with several
   * online machines is unrouted and still needs the picker.
   */
  deviceCapable?: boolean;
  disabledPluginIds?: readonly string[];
  disableLocalSystem?: boolean;
  /** The manifests the engine enabled for the invocation set. */
  enabledManifests: ReadonlyMap<string, LobeToolManifest>;
  exclusivePluginIds?: readonly string[];
  executionTarget: DeviceExecutionTarget;
  /** Disabled-filtered LobeHub skill manifests. */
  lobehubSkills?: readonly LobeToolManifest[];
}

export interface DiscoveryPool {
  /** The single guard every ingest into the pool goes through. */
  isManifestIngestAllowed: (identifier: string) => boolean;
  /** What the activator may discover and enable mid-run. */
  manifestMap: Record<string, LobeToolManifest>;
  /** Which family a discovered tool executes through. */
  sourceMap: Record<string, ToolSource>;
}

/**
 * The pool the activator may resolve tools from mid-run: the enabled
 * manifests, every discoverable builtin the walls allow, and the connector
 * families. Device and sandbox tools only appear when the run can reach
 * them — explicit activation bypasses the enable rules, so what is not
 * reachable must not be discoverable at all.
 */
export const resolveDiscoveryPool = (request: DiscoveryPoolRequest): DiscoveryPool => {
  const { device, deviceAccess, executionTarget } = request;
  const hasDeviceProxy = !!device;
  const disabled = new Set(request.disabledPluginIds ?? []);
  const exclusive = request.exclusivePluginIds ? new Set(request.exclusivePluginIds) : undefined;
  const canUseDevice = deviceAccess?.canUseDevice ?? true;
  const deviceLocked = deviceAccess?.deviceLocked ?? false;

  // A device-LOCKED run keeps local-system but must not expose the picker:
  // leaving it discoverable would let explicit activation re-surface the
  // device list mid-run. Enforced at the ingest layer so no later source
  // can re-add an identifier the walls removed.
  const isManifestIngestAllowed = (identifier: string): boolean => {
    if (exclusive && !exclusive.has(identifier)) return false;
    if (disabled.has(identifier)) return false;
    if (
      hasDeviceProxy &&
      identifier === AuvManifest.identifier &&
      !device.supportedTools?.includes(identifier)
    )
      return false;
    if (!canUseDevice && isDeviceToolIdentifier(identifier)) return false;
    if (deviceLocked && REMOTE_DEVICE_TOOL_IDENTIFIERS.has(identifier)) return false;
    return true;
  };

  const manifestMap: Record<string, LobeToolManifest> = {};
  const sourceMap: Record<string, ToolSource> = {};

  // Seed with the invocation set (candidates ∪ defaults the engine enabled).
  request.enabledManifests.forEach((manifest, id) => {
    if (isManifestIngestAllowed(id)) manifestMap[id] = manifest;
  });

  const runtimeMode = executionTargetToRuntimeMode(executionTarget);
  const deviceCapable = request.deviceCapable ?? false;
  // Auto mode lets the model choose the sandbox or the routed device per
  // call, so the sandbox stays discoverable there too.
  const cloudSandboxAllowed = runtimeMode === 'cloud' || executionTarget === 'auto';
  if (!cloudSandboxAllowed) delete manifestMap[CloudSandboxManifest.identifier];
  // A `none` / `sandbox` run behind a gateway must not expose device tools:
  // "no device" means NO device, not "no device yet". Without a gateway the
  // desktop client owns the tool gate and routes in-process.
  const stripDeviceTools = hasDeviceProxy && !deviceCapable;
  if (stripDeviceTools) {
    delete manifestMap[AuvManifest.identifier];
    delete manifestMap[RemoteDeviceManifest.identifier];
    delete manifestMap[LocalSystemManifest.identifier];
  }

  // Discoverable builtins the activator may enable later (e.g. creds, task);
  // `discoverable: false` keeps infrastructure tools out of the listing.
  for (const tool of request.builtinTools) {
    if (!isManifestIngestAllowed(tool.identifier)) continue;
    if (tool.identifier === CloudSandboxManifest.identifier && !cloudSandboxAllowed) continue;
    if (stripDeviceTools && isDeviceToolIdentifier(tool.identifier)) continue;
    if (tool.discoverable !== false && !manifestMap[tool.identifier]) {
      manifestMap[tool.identifier] = tool.manifest as LobeToolManifest;
    }
  }

  // Local-system and Computer Use are only `discoverable` on the desktop, so
  // a gateway server injects them explicitly for a `local` target.
  for (const manifest of [LocalSystemManifest, AuvManifest]) {
    if (
      !request.disableLocalSystem &&
      isManifestIngestAllowed(manifest.identifier) &&
      hasDeviceProxy &&
      runtimeMode === 'local' &&
      !manifestMap[manifest.identifier]
    ) {
      manifestMap[manifest.identifier] = manifest as LobeToolManifest;
    }
  }

  // Connector families, with the source the runtime executes them through.
  const ingestFamily = (manifests: readonly LobeToolManifest[], source: ToolSource) => {
    for (const manifest of manifests) {
      if (!isManifestIngestAllowed(manifest.identifier)) continue;
      if (!manifestMap[manifest.identifier]) manifestMap[manifest.identifier] = manifest;
      sourceMap[manifest.identifier] = source;
    }
  };
  ingestFamily(request.lobehubSkills ?? [], 'lobehubSkill');
  ingestFamily(request.composio ?? [], 'composio');

  return { isManifestIngestAllowed, manifestMap, sourceMap };
};

export interface ClientExecutorsRequest {
  /** Identifiers the engine enabled for this run. */
  enabledIds: ReadonlySet<string>;
  /** A device gateway exists; tool calls tunnel to a registered device. */
  hasDeviceProxy: boolean;
  manifestMap: Readonly<Record<string, LobeToolManifest>>;
  /** Connectors and installed plugins that run over stdio (a local process). */
  stdioIdentifiers?: readonly string[];
}

/**
 * Tools that must run on the user's machine (local-system, stdio MCP) are
 * marked for direct client dispatch only in the standalone deployment: with a
 * gateway every caller converges on the device-gateway path and the executor
 * stays unset so the remote-device proxy resolves the route.
 */
export const resolveClientExecutors = (
  request: ClientExecutorsRequest,
): Record<string, ToolExecutor> => {
  const executorMap: Record<string, ToolExecutor> = {};
  if (request.hasDeviceProxy) return executorMap;
  for (const [id, manifest] of Object.entries(request.manifestMap)) {
    if ((manifest as { executors?: string[] })?.executors?.includes('client'))
      executorMap[id] = 'client';
  }
  for (const id of request.stdioIdentifiers ?? []) {
    if (request.enabledIds.has(id)) executorMap[id] = 'client';
  }
  return executorMap;
};

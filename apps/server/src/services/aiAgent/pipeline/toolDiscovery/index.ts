import { BrowserManifest } from '@lobechat/builtin-tool-browser';
import { CloudSandboxManifest } from '@lobechat/builtin-tool-cloud-sandbox';
import { LocalSystemManifest } from '@lobechat/builtin-tool-local-system';
import type { LobeToolManifest, ToolExecutor, ToolSource } from '@lobechat/context-engine';
import { buildAtomicCapabilityBundle, hashContent } from '@lobechat/context-engine/onDemand';
import type {
  AtomicCapabilityBundle,
  OnDemandCapabilitySource,
  OnDemandDiscoveryPool,
  OnDemandToolCard,
} from '@lobechat/types';
import { ON_DEMAND_BOOTSTRAP_IDENTIFIERS, ON_DEMAND_PROTOCOL_VERSION } from '@lobechat/types';
import { isLocalOrPrivateUrl } from '@lobechat/utils';

import { isDeviceToolIdentifier } from '@/server/services/aiAgent/deviceToolRegistry';

const DISABLED_API_PREFIX = '[TOOL DISABLED]';

export interface BuildOnDemandDiscoveryPoolParams {
  agentId?: string;
  /** Optional final allowlist for discoverability; identifiers outside it never become cards. */
  allowedIdentifiers?: ReadonlySet<string>;
  canUseDevice?: boolean;
  deviceOnline?: boolean;
  /** Execution target resolved for this run (`local`, `device`, `sandbox`, `none`, ...). */
  executionTarget?: string;
  executorMap?: Readonly<Record<string, ToolExecutor>>;
  gatewayConfigured: boolean;
  manifestMap: Readonly<Record<string, LobeToolManifest>>;
  /** Installed plugin identifiers, used to keep the card source faithful. */
  pluginIdentifiers?: ReadonlySet<string>;
  sourceMap?: Readonly<Record<string, ToolSource>>;
  workspaceId?: string;
}

const bootstrapIdentifiers = new Set<string>(ON_DEMAND_BOOTSTRAP_IDENTIFIERS);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const sanitizeManifest = (manifest: LobeToolManifest): LobeToolManifest => ({
  ...manifest,
  api: manifest.api.filter((api) => !api.description?.trimStart().startsWith(DISABLED_API_PREFIX)),
});

const sourceFor = (
  identifier: string,
  manifest: LobeToolManifest,
  sourceMap: Readonly<Record<string, ToolSource>>,
  pluginIdentifiers: ReadonlySet<string>,
): OnDemandCapabilitySource => {
  const source = sourceMap[identifier];
  if (source === 'composio') return 'composio';
  if (source === 'lobehubSkill') return 'lobehub-skill';
  if (source === 'mcp') return 'mcp';
  if (source === 'client') return 'plugin';
  if (manifest.type === 'mcp') return 'mcp';
  if (pluginIdentifiers.has(identifier)) return 'plugin';
  return 'builtin';
};

const getMcpType = (manifest: LobeToolManifest): string | undefined => {
  const mcpParams = (manifest as { mcpParams?: unknown }).mcpParams;
  return isRecord(mcpParams) && typeof mcpParams.type === 'string' ? mcpParams.type : undefined;
};

const isDeviceOnlyMcp = (manifest: LobeToolManifest): boolean => {
  const mcpParams = (manifest as { mcpParams?: Record<string, unknown> }).mcpParams;
  if (!isRecord(mcpParams)) return false;

  return (
    mcpParams.type === 'stdio' ||
    (mcpParams.type === 'http' &&
      typeof mcpParams.url === 'string' &&
      isLocalOrPrivateUrl(mcpParams.url))
  );
};

const isReachable = ({
  canUseDevice,
  deviceOnline,
  executionTarget,
  gatewayConfigured,
  identifier,
  manifest,
}: {
  canUseDevice?: boolean;
  deviceOnline?: boolean;
  executionTarget?: string;
  gatewayConfigured: boolean;
  identifier: string;
  manifest: LobeToolManifest;
}): boolean => {
  const isDeviceTool = isDeviceToolIdentifier(identifier);
  if (canUseDevice === false && isDeviceTool) return false;

  // Discovery must mirror agent-mode eligibility: plain-chat (`none`) and
  // sandbox runs have no device execution path to advertise.
  if (
    isDeviceTool &&
    executionTarget !== undefined &&
    executionTarget !== 'local' &&
    executionTarget !== 'device' &&
    executionTarget !== 'auto'
  ) {
    return false;
  }

  // In gateway deployments, stdio/private-network MCP servers live on a
  // user's machine. Without an online device there is no execution path, so
  // the capability must not be advertised or activatable. Native device tools
  // (local-system, browser, remote-device) have the same reachability gate.
  // Standalone deployments execute client tools in-process.
  if (gatewayConfigured && !deviceOnline && (isDeviceTool || isDeviceOnlyMcp(manifest))) {
    return false;
  }

  return true;
};

const executionFor = ({
  executionTarget,
  executor,
  identifier,
  manifest,
}: {
  executionTarget?: string;
  executor?: ToolExecutor;
  identifier: string;
  manifest: LobeToolManifest;
}) => {
  if (executor === 'client') {
    return { environment: 'client' as const, transport: 'builtin-native' as const };
  }

  if (identifier === CloudSandboxManifest.identifier || executionTarget === 'sandbox') {
    return { environment: 'sandbox' as const, transport: 'in-process' as const };
  }

  if (
    identifier === LocalSystemManifest.identifier ||
    identifier === BrowserManifest.identifier ||
    getMcpType(manifest) === 'stdio'
  ) {
    return { environment: 'device' as const, transport: 'device-gateway' as const };
  }

  const mcpType = getMcpType(manifest);
  if (mcpType) {
    return {
      environment: 'server' as const,
      transport: mcpType === 'cloud' ? ('http' as const) : ('mcp' as const),
    };
  }

  return { environment: 'server' as const, transport: 'builtin-native' as const };
};

const capabilityFor = (manifest: LobeToolManifest): string =>
  manifest.meta.description?.trim() ||
  manifest.api
    .slice(0, 3)
    .map((api) => api.description)
    .filter(Boolean)
    .join(' ');

const permissionsFor = ({
  agentId,
  manifest,
  workspaceId,
}: {
  agentId?: string;
  manifest: LobeToolManifest;
  workspaceId?: string;
}) => ({
  grants: [
    {
      principal: agentId
        ? { id: agentId, type: 'agent' as const }
        : { id: workspaceId ?? 'workspace', type: 'workspace' as const },
      scopes: ['tool:execute', ...manifest.api.map((api) => `api:${api.name}`)],
    },
  ],
  sharedAuthorizations: workspaceId
    ? [{ authorizationId: `workspace:${workspaceId}`, scopes: ['tool:execute'] }]
    : [],
});

/**
 * Builds the operation's activation-only capability set. Bootstrap tools are
 * omitted because they are already callable; every other card is backed by the
 * exact native manifest and untruncated manual that resolution will load.
 */
export const buildOnDemandDiscoveryPool = (
  params: BuildOnDemandDiscoveryPoolParams,
): OnDemandDiscoveryPool => {
  const identifiers = Object.keys(params.manifestMap)
    .filter(
      (identifier) =>
        !bootstrapIdentifiers.has(identifier) &&
        (!params.allowedIdentifiers || params.allowedIdentifiers.has(identifier)),
    )
    .sort();
  const bundles: Record<string, AtomicCapabilityBundle> = {};
  const cards: OnDemandToolCard[] = [];

  for (const identifier of identifiers) {
    const nativeManifest = params.manifestMap[identifier];
    if (!nativeManifest || !Array.isArray(nativeManifest.api)) continue;
    if (
      !isReachable({
        canUseDevice: params.canUseDevice,
        deviceOnline: params.deviceOnline,
        executionTarget: params.executionTarget,
        gatewayConfigured: params.gatewayConfigured,
        identifier,
        manifest: nativeManifest,
      })
    ) {
      continue;
    }

    // Disabled connector APIs are not executable. Remove them before hashing so
    // neither the card nor the manual advertises a blocked capability.
    const manifest = sanitizeManifest(nativeManifest);
    if (manifest.api.length === 0) continue;

    const source = sourceFor(
      identifier,
      manifest,
      params.sourceMap ?? {},
      params.pluginIdentifiers ?? new Set(),
    );
    const execution = executionFor({
      executionTarget: params.executionTarget,
      executor: params.executorMap?.[identifier],
      identifier,
      manifest,
    });
    const runtime =
      source === 'composio'
        ? ('plugin-runtime' as const)
        : source === 'mcp'
          ? ('mcp-runtime' as const)
          : execution.environment === 'client'
            ? ('client' as const)
            : ('server' as const);
    let bundle: AtomicCapabilityBundle;
    try {
      bundle = buildAtomicCapabilityBundle({
        execution,
        identifier,
        manifest,
        permissions: permissionsFor({
          agentId: params.agentId,
          manifest,
          workspaceId: params.workspaceId,
        }),
        sourceRuntime: { runtime, source },
      });
    } catch {
      // One malformed persisted manifest must not take down the whole
      // operation or leak an unvalidated card. Omit it and fail closed.
      continue;
    }

    bundles[identifier] = bundle;
    cards.push({
      ...(manifest.meta.avatar && { avatar: manifest.meta.avatar }),
      capability: capabilityFor(manifest),
      executionEnvironment: bundle.execution.environment,
      hash: bundle.hash,
      identifier,
      name: manifest.meta.title || identifier,
      source,
      version: bundle.version,
    });
  }

  return {
    bundles,
    cards,
    hash: hashContent({ cards, bundles }),
    version: ON_DEMAND_PROTOCOL_VERSION,
  };
};

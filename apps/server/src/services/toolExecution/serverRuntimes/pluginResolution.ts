import { builtinTools } from '@lobechat/builtin-tools';
import { getConnectorCatalog } from '@lobechat/const';

import type { ConnectorModel } from '@/database/models/connector';
import type { PluginModel } from '@/database/models/plugin';

import type { ToolExecutionResult } from '../types';

/**
 * Whether a plugin id an agent-editing tool is about to pin resolves to tools
 * the runtime can actually load:
 *
 * - `loadable`: a builtin, an enabled and connected connector, or an installed
 *   plugin whose manifest lists its APIs.
 * - `not-connected`: an official integration or a user connector that exists
 *   but is disabled / not connected, so it contributes no tools yet.
 * - `no-tools`: installed, but the manifest has no API list, so the tool pool
 *   drops it on every run (e.g. a custom MCP behind OAuth that was never
 *   connected).
 * - `unknown`: nothing by that id; `suggestions` holds near matches such as
 *   `tg-mcp` for `tg_mcp`.
 */
export type PluginResolution =
  | { source: 'builtin' | 'connector' | 'installed'; status: 'loadable' }
  | { status: 'no-tools' }
  | { status: 'not-connected' }
  | { status: 'unknown'; suggestions: string[] };

export interface PluginResolverDeps {
  connectorModel: Pick<ConnectorModel, 'resolveAll'>;
  pluginModel: Pick<PluginModel, 'findById' | 'query'>;
}

const catalogIdentifiers = (): string[] =>
  getConnectorCatalog({ composio: true, lobehub: true }).map((item) =>
    item.type === 'lobehub' ? item.provider.id : item.serverType.identifier,
  );

/** Mirrors the tool pool's validity check, which drops manifests without an `api` array. */
export const hasLoadableApis = (manifest: unknown): boolean =>
  Array.isArray((manifest as { api?: unknown } | null | undefined)?.api);

const normalize = (id: string) => id.toLowerCase().replaceAll(/[\s_.]+/g, '-');

export const resolvePluginIdentifier = async (
  identifier: string,
  deps: PluginResolverDeps,
  options: { agentId?: string } = {},
): Promise<PluginResolution> => {
  if (builtinTools.some((tool) => tool.identifier === identifier))
    return { source: 'builtin', status: 'loadable' };

  // A connector shadows a same-named installed plugin, but only once it is
  // enabled and connected — a disabled or disconnected row contributes no tools.
  const connectors = await deps.connectorModel.resolveAll(options.agentId);
  const connector = connectors.find((c) => c.identifier === identifier);
  if (connector) {
    return connector.isEnabled && connector.status === 'connected'
      ? { source: 'connector', status: 'loadable' }
      : { status: 'not-connected' };
  }

  const installed = await deps.pluginModel.findById(identifier);
  if (installed) {
    return hasLoadableApis(installed.manifest)
      ? { source: 'installed', status: 'loadable' }
      : { status: 'no-tools' };
  }

  const catalog = catalogIdentifiers();
  if (catalog.includes(identifier)) return { status: 'not-connected' };

  const installedIds = (await deps.pluginModel.query()).map((p) => p.identifier);
  const target = normalize(identifier);
  const suggestions = [
    ...new Set([...connectors.map((c) => c.identifier), ...installedIds, ...catalog]),
  ].filter((id) => normalize(id) === target);

  return { status: 'unknown', suggestions };
};

/** The failure returned instead of pinning an id that would load no tools. */
export const unresolvablePluginResult = (
  identifier: string,
  resolution: Exclude<PluginResolution, { status: 'loadable' }>,
): ToolExecutionResult => {
  if (resolution.status === 'no-tools') {
    return {
      content: `Plugin "${identifier}" is installed but exposes no tools, so enabling it would not make any tool available. Its manifest has no API list — an MCP server that needs OAuth must be connected by the user in Settings → Connectors first. Nothing was changed.`,
      error: { message: 'Plugin has no loadable tools', type: 'PluginHasNoTools' },
      success: false,
    };
  }

  if (resolution.status === 'not-connected') {
    return {
      content: `"${identifier}" is an integration that is not connected (or is disabled), so it provides no tools yet. Ask the user to connect it in Settings → Connectors, then enable it. Nothing was changed.`,
      error: { message: 'Integration is not connected', type: 'PluginNotConnected' },
      success: false,
    };
  }

  const hint =
    resolution.suggestions.length > 0
      ? ` Did you mean: ${resolution.suggestions.map((id) => `"${id}"`).join(', ')}?`
      : ' Use an exact identifier from the available plugins or connectors, or search the marketplace first.';

  return {
    content: `No builtin tool, connector or installed plugin has the identifier "${identifier}".${hint} Nothing was changed.`,
    error: { message: 'Unknown plugin identifier', type: 'PluginNotFound' },
    success: false,
  };
};

export interface MarketPluginDeps extends PluginResolverDeps {
  discoverService: { getMcpManifest: (params: { identifier: string }) => Promise<unknown> };
  pluginModel: PluginResolverDeps['pluginModel'] & Pick<PluginModel, 'create' | 'update'>;
}

/**
 * Resolve a plugin id for `installPlugin`. A `market` install is satisfied by
 * the marketplace plugin itself: an installed row with APIs, or a manifest
 * fetched now — a same-named builtin, catalog id or connector does not count
 * as that install. Only when the marketplace has nothing does it fall back to
 * the source-agnostic resolution. A row is written only when the fetched
 * manifest lists its APIs, and a custom plugin's own manifest is never
 * overwritten.
 *
 * `installedNow` is true when this call created or filled the row: such a tool
 * was not in the current run's tool pool, so it loads from the next run.
 */
export const resolveOrInstallMarketPlugin = async (
  identifier: string,
  deps: MarketPluginDeps,
  options: { agentId?: string; source?: string } = {},
): Promise<{ installedNow: boolean; resolution: PluginResolution }> => {
  if (options.source !== 'market')
    return {
      installedNow: false,
      resolution: await resolvePluginIdentifier(identifier, deps, options),
    };

  const existing = await deps.pluginModel.findById(identifier);
  if (existing && hasLoadableApis(existing.manifest))
    return { installedNow: false, resolution: { source: 'installed', status: 'loadable' } };
  if (existing?.manifest) return { installedNow: false, resolution: { status: 'no-tools' } };

  let manifest: unknown;
  try {
    manifest = await deps.discoverService.getMcpManifest({ identifier });
  } catch {
    // Not a marketplace plugin (or the market is unreachable).
  }

  if (hasLoadableApis(manifest)) {
    if (existing) await deps.pluginModel.update(identifier, { manifest: manifest as any });
    else await deps.pluginModel.create({ identifier, manifest: manifest as any, type: 'plugin' });

    return { installedNow: true, resolution: { source: 'installed', status: 'loadable' } };
  }

  return {
    installedNow: false,
    resolution: await resolvePluginIdentifier(identifier, deps, options),
  };
};

export const NEXT_RUN_NOTE =
  ' Its tools load when the agent starts its next run; activateTools cannot reach them in a run that is already in progress.';

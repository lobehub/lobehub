import { builtinTools } from '@lobechat/builtin-tools';
import { getConnectorCatalog } from '@lobechat/const';

import type { ConnectorModel } from '@/database/models/connector';
import type { PluginModel } from '@/database/models/plugin';

import type { ToolExecutionResult } from '../types';

/**
 * Whether a plugin id an agent-editing tool is about to pin resolves to tools
 * the runtime can actually load:
 *
 * - `loadable`: a builtin, an official connector, a user connector, or an
 *   installed plugin whose manifest lists its APIs.
 * - `no-tools`: installed, but the manifest has no API list, so the tool pool
 *   drops it on every run (e.g. a custom MCP behind OAuth that was never
 *   connected, or a market install whose manifest fetch failed).
 * - `unknown`: nothing by that id; `suggestions` holds near matches such as
 *   `tg-mcp` for `tg_mcp`.
 */
export type PluginResolution =
  | { source: 'builtin' | 'catalog' | 'connector' | 'installed'; status: 'loadable' }
  | { status: 'no-tools' }
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

  const catalog = catalogIdentifiers();
  if (catalog.includes(identifier)) return { source: 'catalog', status: 'loadable' };

  // A connector shadows a same-named installed plugin in the tool pool, so it
  // is checked first.
  const connectorIds = (await deps.connectorModel.resolveAll(options.agentId)).map(
    (c) => c.identifier,
  );
  if (connectorIds.includes(identifier)) return { source: 'connector', status: 'loadable' };

  const installed = await deps.pluginModel.findById(identifier);
  if (installed) {
    return hasLoadableApis(installed.manifest)
      ? { source: 'installed', status: 'loadable' }
      : { status: 'no-tools' };
  }

  const installedIds = (await deps.pluginModel.query()).map((p) => p.identifier);
  const target = normalize(identifier);
  const suggestions = [...new Set([...connectorIds, ...installedIds, ...catalog])].filter(
    (id) => normalize(id) === target,
  );

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
 * Resolve a plugin id for `installPlugin`, installing it from the marketplace
 * when nothing loadable exists yet. A row is only written once the fetched
 * manifest lists its APIs — a row without them would be pinned yet never load.
 * A custom plugin's own manifest is never overwritten.
 *
 * `installedNow` is true when this call created or filled the row: such a tool
 * was not in the current run's tool pool, so it loads from the next run.
 */
export const resolveOrInstallMarketPlugin = async (
  identifier: string,
  deps: MarketPluginDeps,
  options: { agentId?: string } = {},
): Promise<{ installedNow: boolean; resolution: PluginResolution }> => {
  const resolution = await resolvePluginIdentifier(identifier, deps, options);
  if (resolution.status === 'loadable') return { installedNow: false, resolution };

  const existing = await deps.pluginModel.findById(identifier);
  if (existing?.manifest) return { installedNow: false, resolution };

  let manifest: unknown;
  try {
    manifest = await deps.discoverService.getMcpManifest({ identifier });
  } catch {
    // Not a marketplace plugin (or the market is unreachable): report the
    // original resolution instead of pinning an id that loads nothing.
  }
  if (!hasLoadableApis(manifest)) return { installedNow: false, resolution };

  if (existing) await deps.pluginModel.update(identifier, { manifest: manifest as any });
  else await deps.pluginModel.create({ identifier, manifest: manifest as any, type: 'plugin' });

  return { installedNow: true, resolution: { source: 'installed', status: 'loadable' } };
};

export const NEXT_RUN_NOTE =
  ' Its tools load when the agent starts its next run; activateTools cannot reach them in a run that is already in progress.';

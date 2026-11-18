import { builtinTools } from '@lobechat/builtin-tools';
import { getConnectorCatalog } from '@lobechat/const';

import type { ConnectorModel } from '@/database/models/connector';
import type { PluginModel } from '@/database/models/plugin';
import type {
  MarketMcpManifest,
  MarketplaceInstallBlocker,
  MarketplaceInstallOptions,
  MarketplaceInstallOutcome,
} from '@/server/services/connector/marketplaceInstall';

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
 * - `needs-user-install`: a marketplace MCP the server cannot install by
 *   itself (`blocker` says why), so the user installs it from the marketplace.
 * - `unknown`: nothing by that id; `suggestions` holds near matches such as
 *   `tg-mcp` for `tg_mcp`.
 */
export type PluginResolution =
  | { source: 'builtin' | 'connector' | 'installed'; status: 'loadable' }
  | { status: 'no-tools' }
  | { status: 'not-connected' }
  | { blocker: MarketplaceInstallBlocker; status: 'needs-user-install' }
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

/** A connector contributes tools only once it is enabled and connected. */
const connectorResolution = (connector: {
  isEnabled: boolean;
  status: string;
}): PluginResolution =>
  connector.isEnabled && connector.status === 'connected'
    ? { source: 'connector', status: 'loadable' }
    : { status: 'not-connected' };

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
  if (connector) return connectorResolution(connector);

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

const NEEDS_USER_INSTALL: Record<
  MarketplaceInstallBlocker,
  { content: (identifier: string) => string; message: string; type: string }
> = {
  'config': {
    content: (id) =>
      `Marketplace MCP "${id}" needs settings only the user can provide (such as an API key), so it cannot be installed from here. Ask the user to install it from the marketplace and fill in its settings, then enable it. Nothing was changed.`,
    message: 'Plugin needs configuration',
    type: 'PluginNeedsConfig',
  },
  'conflict': {
    content: (id) =>
      `A connector with the identifier "${id}" already exists and is not a finished install of this marketplace MCP. Ask the user to remove it (or finish its install) in Settings → Connectors first. Nothing was changed.`,
    message: 'Connector identifier already in use',
    type: 'PluginIdentifierConflict',
  },
  'forbidden': {
    content: (id) =>
      `Only workspace owners and admins can add connectors in this workspace, so "${id}" was not installed. Ask a workspace admin to install it. Nothing was changed.`,
    message: 'Not allowed to add workspace connectors',
    type: 'PluginInstallForbidden',
  },
  'in-progress': {
    content: (id) =>
      `Marketplace MCP "${id}" is already being installed: an install started in the last few minutes has not finished. Try installPlugin again in a few minutes. Nothing was changed.`,
    message: 'Plugin install already in progress',
    type: 'PluginInstallInProgress',
  },
  'local-only': {
    content: (id) =>
      `Marketplace MCP "${id}" has no remote endpoint: it runs as a local (stdio) process, which only the LobeHub desktop app can start. Ask the user to install it from the marketplace in the desktop app. Nothing was changed.`,
    message: 'Plugin runs only as a local process',
    type: 'PluginNeedsDesktop',
  },
  'private-network': {
    content: (id) =>
      `Marketplace MCP "${id}" is served only at a localhost or private-network address, which this server would have to reach through the user's own machine, so it cannot be installed from here. Ask the user to install it from the marketplace in the LobeHub desktop app. Nothing was changed.`,
    message: 'Plugin endpoint is on a private network',
    type: 'PluginNeedsDesktop',
  },
  'no-tools': {
    content: (id) =>
      `Marketplace MCP "${id}" lists no tools, so installing it would not make any tool available. Nothing was changed.`,
    message: 'Plugin has no loadable tools',
    type: 'PluginHasNoTools',
  },
  'oauth': {
    content: (id) =>
      `Marketplace MCP "${id}" signs in with OAuth, which the user has to authorize in their browser. Ask the user to install it from the marketplace and complete the sign-in, then enable it. Nothing was changed.`,
    message: 'Plugin needs OAuth authorization',
    type: 'PluginNeedsAuthorization',
  },
};

const needsUserInstallResult = (
  identifier: string,
  { blocker }: { blocker: MarketplaceInstallBlocker },
): ToolExecutionResult => {
  const { content, message, type } = NEEDS_USER_INSTALL[blocker];
  return { content: content(identifier), error: { message, type }, success: false };
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

  if (resolution.status === 'needs-user-install')
    return needsUserInstallResult(identifier, resolution);

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
  connectorModel: Pick<ConnectorModel, 'queryAvailableForAgent' | 'resolveAll'>;
  discoverService: {
    /** The MCP's market detail, which says whether the market hosts it (`haveCloudEndpoint`). */
    getMcpDetail: (params: { identifier: string }) => Promise<unknown>;
    getMcpManifest: (params: { identifier: string }) => Promise<unknown>;
  };
  /** Stores a marketplace MCP as a connector (`installMarketplaceMcpConnector`). */
  installMarketplaceConnector: (
    identifier: string,
    manifest: MarketMcpManifest,
    options?: MarketplaceInstallOptions,
  ) => Promise<MarketplaceInstallOutcome>;
}

/**
 * Resolve a plugin id for `installPlugin`. A `market` install is satisfied by
 * the marketplace MCP itself: a legacy installed plugin row with APIs, a
 * finished marketplace connector install, or one made now — a same-named
 * builtin or catalog id does not count as that install. Only when the
 * marketplace has nothing does it fall back to the source-agnostic resolution.
 *
 * An install made now lands in `user_connectors`, as the web install does; no
 * `user_installed_plugins` row is written, while rows written before stay
 * readable. `installedNow` is true when this call installed it: such a tool was
 * not in the current run's tool pool, so it loads from the next run.
 */
export const resolveOrInstallMarketPlugin = async (
  identifier: string,
  deps: MarketPluginDeps,
  options: { agentId?: string; source?: string } = {},
): Promise<{ installedNow: boolean; resolution: PluginResolution }> => {
  const resolveExisting = async () => ({
    installedNow: false,
    resolution: await resolvePluginIdentifier(identifier, deps, options),
  });

  if (options.source !== 'market') return resolveExisting();

  const existing = await deps.pluginModel.findById(identifier);
  if (existing && hasLoadableApis(existing.manifest))
    return { installedNow: false, resolution: { source: 'installed', status: 'loadable' } };
  if (existing?.manifest) return { installedNow: false, resolution: { status: 'no-tools' } };

  // The agent's own row of the identifier comes first in its runs, so a base
  // install would never serve it: answer as its runs will, installing nothing.
  // In its own conversation, so does its owner's private or personal row (a
  // private agent's configuration scope), which a run without that topic does
  // not resolve: answer as that row, rather than add a shared one it shadows.
  if (options.agentId) {
    const [runnable, configurable] = await Promise.all([
      deps.connectorModel.resolveAll(options.agentId),
      deps.connectorModel.queryAvailableForAgent(options.agentId),
    ]);
    const run = runnable.find((c) => c.identifier === identifier);
    if (run?.agentId === options.agentId) return resolveExisting();
    const own = configurable.find((c) => c.identifier === identifier);
    if (own && own.id !== run?.id)
      return { installedNow: false, resolution: connectorResolution(own) };
  }

  let manifest: unknown;
  try {
    manifest = await deps.discoverService.getMcpManifest({ identifier });
  } catch {
    // Not a marketplace plugin (or the market is unreachable).
  }
  if (!manifest || typeof manifest !== 'object') return resolveExisting();

  const outcome = await deps.installMarketplaceConnector(
    identifier,
    manifest as MarketMcpManifest,
    {
      // Whether the market hosts a stdio server is on its detail, not its
      // manifest, and the web install reads it there too: without it a hosted
      // server would be refused as one only the desktop app can run. A detail it
      // cannot read fails the install, as it fails the web's, rather than reading
      // as "not hosted"; the installer asks only when it decides the deployment.
      readHostedEndpoint: async () =>
        (
          (await deps.discoverService.getMcpDetail({ identifier })) as
            { haveCloudEndpoint?: unknown } | undefined
        )?.haveCloudEndpoint,
    },
  );
  switch (outcome.status) {
    case 'installed': {
      // Resolve as the agent's runs will (an agent row added meanwhile comes first)
      const { resolution } = await resolveExisting();
      return { installedNow: true, resolution };
    }
    case 'exists': {
      // Enabled and connected, or not: the connector answers like any other
      return resolveExisting();
    }
    case 'blocked': {
      return {
        installedNow: false,
        resolution: { blocker: outcome.blocker, status: 'needs-user-install' },
      };
    }
  }
};

export const NEXT_RUN_NOTE =
  ' Its tools load when the agent starts its next run; activateTools cannot reach them in a run that is already in progress.';

/**
 * Marketplace (formerly Community) URL layout.
 *
 * The internal ids (`SidebarTabKey.Community`, route id `'community'`,
 * `DiscoverTab`, the `(main)/community` route folder) keep their old names so
 * persisted sidebar settings need no migration; only the URL moved.
 */
export const MARKETPLACE_SEGMENT = 'marketplace';

/** Pre-rename first segment; its routes redirect to {@link MARKETPLACE_SEGMENT}. */
export const LEGACY_COMMUNITY_SEGMENT = 'community';

export const MARKETPLACE_PATH = `/${MARKETPLACE_SEGMENT}`;

export const MARKETPLACE_AGENT_PATH = `${MARKETPLACE_PATH}/agent`;

export const MARKETPLACE_APPS_PATH = `${MARKETPLACE_PATH}/app`;
export const MARKETPLACE_CONNECTED_APPS_PATH = `${MARKETPLACE_APPS_PATH}?view=connected`;
export const marketplaceAppPath = (id: string) =>
  `${MARKETPLACE_APPS_PATH}/${encodeURIComponent(id)}`;

/** Skills discovery (the public catalog). */
export const MARKETPLACE_SKILL_PATH = `${MARKETPLACE_PATH}/skill`;

/** Installed skills management — moved here from `/settings/skill`. */
export const MARKETPLACE_INSTALLED_SKILLS_PATH = `${MARKETPLACE_SKILL_PATH}/installed`;

/** Legacy catalog links use their search parameters to select Apps or MCP. */
export const MARKETPLACE_CONNECTOR_PATH = `${MARKETPLACE_PATH}/connector`;

/** Installed connector management — moved here from `/settings/connector`. */
export const MARKETPLACE_INSTALLED_CONNECTORS_PATH = `${MARKETPLACE_CONNECTOR_PATH}/installed`;

/** Public MCP catalog and server details. */
export const MARKETPLACE_MCP_PATH = `${MARKETPLACE_PATH}/mcp`;

export const MARKETPLACE_INSTALLED_MCP_PATH = `${MARKETPLACE_MCP_PATH}/installed`;

export const getLegacyConnectorCatalogPath = (params: URLSearchParams) => {
  const publicCatalog =
    params.get('source') === 'public' ||
    (params.get('group') !== 'integrations' &&
      ['category', 'sort', 'page', 'connectionType'].some((key) => params.has(key)));
  return publicCatalog ? MARKETPLACE_MCP_PATH : MARKETPLACE_APPS_PATH;
};

export const getMarketplaceEntryPath = (showMarket: boolean | undefined): string =>
  showMarket ? MARKETPLACE_APPS_PATH : MARKETPLACE_INSTALLED_CONNECTORS_PATH;

/** Remaining marketplace path after the (optionally workspace-prefixed) marketplace root. */
export const getMarketplaceSubPath = (pathname: string): string | undefined => {
  const segments = pathname.split('/').filter(Boolean);
  const index = segments.findIndex(
    (segment) => segment === MARKETPLACE_SEGMENT || segment === LEGACY_COMMUNITY_SEGMENT,
  );
  // Only the first segment (`/marketplace`) or the one after a workspace slug
  // (`/:slug/marketplace`) is the marketplace root.
  if (index < 0 || index > 1) return undefined;

  return segments.slice(index + 1).join('/');
};

// The catalog pages render their own search and actions in the content header.
export const hasCatalogPageHeader = (pathname: string): boolean => {
  const section = getMarketplaceSubPath(pathname);
  return (
    section === 'agent' ||
    section === 'skill' ||
    section === 'connector' ||
    section === 'mcp' ||
    section === 'app' ||
    section?.startsWith('app/') === true
  );
};

/**
 * Where an agent's "Manage library" opens: the installed skills for the skills
 * group, the installed connectors otherwise.
 */
export const getManageLibraryPath = (kind?: string): string =>
  kind === 'skills' ? MARKETPLACE_INSTALLED_SKILLS_PATH : MARKETPLACE_INSTALLED_CONNECTORS_PATH;

import { MARKETPLACE_APPS_PATH, marketplaceAppPath } from '@/features/Marketplace/paths';

/**
 * Connectors whose Marketplace page also manages a LobeHub-owned integration
 * (the GitHub App, a Linear workspace), so the page has content before the
 * user's account is connected.
 */
export const CONNECTOR_PAGE_IDS = ['github', 'linear'] as const;

export type ConnectorPageId = (typeof CONNECTOR_PAGE_IDS)[number];

/** What an integration's install callback reports back in the query. */
export const INSTALL_RESULT_PARAMS = ['installed', 'error', 'account', 'pending'] as const;

export const hasConnectorPage = (identifier: string): identifier is ConnectorPageId =>
  (CONNECTOR_PAGE_IDS as readonly string[]).includes(identifier);

/** The connector's Marketplace page, carrying an install result over from `search`. */
export const buildConnectorPagePath = (identifier: ConnectorPageId, search = ''): string => {
  const source = new URLSearchParams(search);
  const params = new URLSearchParams();
  for (const key of INSTALL_RESULT_PARAMS) {
    const value = source.get(key);
    if (value) params.set(key, value);
  }
  const path = marketplaceAppPath(identifier);
  return params.size ? `${path}?${params}` : path;
};

/**
 * Where a retired `/settings/integrations[/:sub]` URL goes. The install
 * callbacks still return to those paths, so their result must survive this.
 */
export const buildLegacyIntegrationPath = (sub: string | undefined, search = ''): string =>
  sub && hasConnectorPage(sub) ? buildConnectorPagePath(sub, search) : MARKETPLACE_APPS_PATH;

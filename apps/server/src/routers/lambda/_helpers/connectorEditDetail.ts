import type { DecryptedConnector } from '@/database/models/connector';

/**
 * A connector as its edit form reads it (and a desktop running a stdio
 * connector itself). User-set credentials (bearer token, custom headers) stay,
 * so the form can display them; machine-managed secrets do not:
 * - `oidcConfig.clientSecret` (the DCR-registered secret) is stripped;
 * - OAuth tokens are dropped, since the UI only needs to know an OAuth flow is
 *   configured, which `oidcConfig` already shows.
 */
export const toConnectorEditDetail = <Tool>(connector: DecryptedConnector, tools: Tool[]) => {
  const { oidcConfig, credentials, ...rest } = connector;
  const safeOidcConfig = oidcConfig ? { ...oidcConfig, clientSecret: undefined } : oidcConfig;
  const safeCredentials = credentials?.type === 'oauth2' ? null : credentials;

  return { ...rest, credentials: safeCredentials, oidcConfig: safeOidcConfig, tools };
};

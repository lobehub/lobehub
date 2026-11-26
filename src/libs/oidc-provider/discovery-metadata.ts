import urlJoin from 'url-join';

import { OIDC_DISCOVERY_PATH, OIDC_ISSUER_PATH } from './routes';

/**
 * OAuth discovery for the public REST API (`/api/v1`, `packages/openapi`).
 *
 * RFC 9728 places a resource's metadata at the well-known prefix inserted before the
 * resource path, and its `resource` must equal that resource URL; RFC 8414 does the
 * same for the authorization server, whose issuer is `<origin>/oidc`. Both documents
 * therefore live on the deployment's own origin (APP_URL), next to the API and the
 * issuer they describe.
 */
export const API_V1_PATH = '/api/v1';

export const PROTECTED_RESOURCE_METADATA_PATH = `/.well-known/oauth-protected-resource${API_V1_PATH}`;

export const AUTHORIZATION_SERVER_METADATA_PATH = `/.well-known/oauth-authorization-server${OIDC_ISSUER_PATH}`;

const API_AUTH_DOCS_URL = 'https://lobehub.com/docs/development/api/authentication';

/** Scopes a client requests from the issuer for an `/api/v1` access token. */
const API_TOKEN_SCOPES = ['openid', 'profile', 'email', 'offline_access'];

export const protectedResourceMetadataUrl = (origin: string) =>
  urlJoin(origin, PROTECTED_RESOURCE_METADATA_PATH);

export const oidcDiscoveryUrl = (origin: string) => urlJoin(origin, OIDC_DISCOVERY_PATH);

/**
 * RFC 9728 metadata of `<origin>/api/v1`. Without OIDC the API still takes API keys,
 * so the document stays but names no authorization server.
 */
export const buildProtectedResourceMetadata = (origin: string, oidcEnabled: boolean) => ({
  ...(oidcEnabled
    ? {
        authorization_servers: [urlJoin(origin, OIDC_ISSUER_PATH)],
        scopes_supported: API_TOKEN_SCOPES,
      }
    : {}),
  bearer_methods_supported: ['header'],
  resource: urlJoin(origin, API_V1_PATH),
  resource_documentation: API_AUTH_DOCS_URL,
  resource_name: 'LobeHub API',
});

/** The `WWW-Authenticate` challenge a 401 from `/api/v1` carries (RFC 6750, RFC 9728 §5.1). */
export const apiBearerChallenge = (origin: string) =>
  `Bearer realm="LobeHub API", resource_metadata="${protectedResourceMetadataUrl(origin)}"`;

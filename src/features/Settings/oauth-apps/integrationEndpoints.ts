import urlJoin from 'url-join';

import { OIDC_DISCOVERY_PATH, OIDC_ISSUER_PATH, OIDC_ROUTES } from '@/libs/oidc-provider/routes';

export type IntegrationEndpointKey =
  'authorization' | 'deviceAuthorization' | 'discovery' | 'issuer' | 'token';

/**
 * The issuer to show: the server's configured one (`APP_URL` + `/oidc`), or —
 * for a server too old to send it — the app origin, which on desktop is the
 * connected server rather than the renderer's own `app://` origin.
 */
export const resolveIssuer = (configured: string | undefined, appOrigin: string) =>
  configured || urlJoin(appOrigin, OIDC_ISSUER_PATH);

export interface IntegrationEndpoint {
  key: IntegrationEndpointKey;
  url: string;
}

/**
 * The URLs a developer configures in their OAuth / OIDC client, in the order
 * they need them. Each app type gets only the endpoints its flow uses: a web
 * app redirects users to the authorization endpoint, a CLI / device app starts
 * at the device authorization endpoint instead.
 *
 * Everything derives from the provider's configured `issuer`, never from the
 * page's own origin: strict clients reject a discovery document whose issuer
 * differs from the one they were given, and the page origin differs behind a
 * reverse proxy or on desktop.
 */
export const getIntegrationEndpoints = (
  issuer: string,
  applicationType?: string | null,
): IntegrationEndpoint[] => {
  const normalizedIssuer = issuer.replace(/\/+$/, '');
  const base = normalizedIssuer.endsWith(OIDC_ISSUER_PATH)
    ? normalizedIssuer.slice(0, -OIDC_ISSUER_PATH.length)
    : normalizedIssuer;
  const url = (path: string) => urlJoin(base, path);
  const isWeb = applicationType === 'web';

  return [
    { key: 'issuer', url: normalizedIssuer },
    { key: 'discovery', url: url(OIDC_DISCOVERY_PATH) },
    isWeb
      ? { key: 'authorization', url: url(OIDC_ROUTES.authorization) }
      : { key: 'deviceAuthorization', url: url(OIDC_ROUTES.device_authorization) },
    { key: 'token', url: url(OIDC_ROUTES.token) },
  ];
};

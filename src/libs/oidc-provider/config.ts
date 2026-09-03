import { BRANDING_LOGO_URL, BRANDING_NAME } from '@lobechat/business-const';
import { type ClientMetadata } from 'oidc-provider';
import urlJoin from 'url-join';

import { appEnv } from '@/envs/app';

const cloudAppOrigins = ['https://app.lobehub.com', 'https://lobehub.com'];
const appUrl = appEnv.APP_URL!;
const desktopAppOrigins = cloudAppOrigins.includes(new URL(appUrl).origin)
  ? cloudAppOrigins
  : [appUrl];
const marketBaseUrl = new URL(appEnv.MARKET_BASE_URL ?? 'https://market.lobehub.com').origin;

/**
 * Consent-screen identity for the first-party clients.
 *
 * `client_name` and `logo_uri` are not internal metadata — `Consent/index.tsx`
 * and `DeviceCodeConfirm.tsx` render them straight to the user, and there is no
 * first-party bypass of the consent step. So on a rebranded deployment the
 * authorisation page was the one screen still introducing the vendor, right at
 * the moment the user is deciding whether to trust the app.
 *
 * The logo falls back to each client's original URL rather than being dropped,
 * matching how `BRANDING_LOGO_URL` is used everywhere else in this codebase
 * (`DEFAULT_INBOX_AVATAR` is the precedent). That keeps the default build
 * byte-identical; a distribution that sets a logo also stops the consent page
 * fetching an image from a CDN a private deployment may not reach.
 *
 * `logo_uri` must be an ABSOLUTE http(s) URI — oidc-provider validates client
 * metadata at registration and rejects the whole client with
 * `invalid_client_metadata: logo_uri must be a web uri`, which fails every
 * authorization request before any screen renders. `BRANDING_LOGO_URL` is a
 * site-relative path in the usual case (it is served from this deployment's own
 * `public/`), so it has to be joined onto the app's origin here rather than
 * passed through.
 */
const absoluteLogoUri = (defaultLogoUri: string): string => {
  if (!BRANDING_LOGO_URL) return defaultLogoUri;
  if (/^https?:\/\//.test(BRANDING_LOGO_URL)) return BRANDING_LOGO_URL;
  return urlJoin(appEnv.APP_URL!, BRANDING_LOGO_URL);
};

const clientDisplay = (suffix: string, defaultLogoUri: string) => ({
  client_name: `${BRANDING_NAME} ${suffix}`,
  logo_uri: absoluteLogoUri(defaultLogoUri),
});

/**
 * Default OIDC client configuration
 */
export const defaultClients: ClientMetadata[] = [
  {
    application_type: 'web',
    client_id: 'lobehub-desktop',
    ...clientDisplay('Desktop', 'https://hub-apac-1.lobeobjects.space/lobehub-desktop-icon.png'),
    // Only supports authorization code flow
    grant_types: ['authorization_code', 'refresh_token'],

    post_logout_redirect_uris: [
      // Keep the legacy subdomain working while Cloud moves to the apex domain.
      ...desktopAppOrigins.map((origin) => urlJoin(origin, '/oauth/logout')),
      'http://localhost:3210/oauth/logout',
    ],

    // Desktop authorization callback - changed to web page path
    redirect_uris: [
      ...desktopAppOrigins.map((origin) => urlJoin(origin, '/oidc/callback/desktop')),
      'http://localhost:3210/oidc/callback/desktop',
    ],

    // Supports authorization code for obtaining tokens and refresh tokens
    response_types: ['code'],

    // Marked as public client with no secret
    token_endpoint_auth_method: 'none',
  },

  {
    application_type: 'native', // Mobile uses native type
    client_id: 'lobehub-mobile',
    ...clientDisplay(
      'Mobile',
      'https://hub-apac-1.lobeobjects.space/docs/73f69adfa1b802a0e250f6ff9d62f70b.png',
    ),
    // Supports authorization code flow and refresh token
    grant_types: ['authorization_code', 'refresh_token'],
    // Mobile does not need post_logout_redirect_uris as logout is typically handled within the app
    post_logout_redirect_uris: [],
    // Mobile uses custom URL Scheme
    redirect_uris: ['com.lobehub.app://auth/callback'],
    response_types: ['code'],
    // Public client with no secret
    token_endpoint_auth_method: 'none',
  },
  {
    application_type: 'native',
    client_id: 'lobehub-cli',
    ...clientDisplay('CLI', 'https://hub-apac-1.lobeobjects.space/lobehub-desktop-icon.png'),
    grant_types: ['urn:ietf:params:oauth:grant-type:device_code', 'refresh_token'],
    response_types: [],
    token_endpoint_auth_method: 'none',
  },
  {
    application_type: 'web',
    client_id: 'lobehub-market',
    ...clientDisplay(
      'Marketplace',
      'https://hub-apac-1.lobeobjects.space/lobehub-desktop-icon.png',
    ),
    grant_types: ['authorization_code', 'refresh_token'],
    post_logout_redirect_uris: [
      urlJoin(marketBaseUrl!, '/lobehub-oidc/logout'),
      'http://localhost:8787/lobehub-oidc/logout',
    ],
    redirect_uris: [
      urlJoin(marketBaseUrl!, '/lobehub-oidc/consent/callback'),
      'http://localhost:8787/lobehub-oidc/consent/callback',
    ],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  },
];

/**
 * OIDC Scopes definition
 */
export const defaultScopes = [
  'openid',
  'profile',
  'email',
  'offline_access', // Allows obtaining refresh_token
];

/**
 * OIDC Claims definition
 */
export const defaultClaims = {
  email: ['email', 'email_verified'],
  openid: ['sub'],
  // subject (unique user identifier)
  profile: ['name', 'picture'],
};

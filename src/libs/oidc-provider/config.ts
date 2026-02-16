import { type ClientMetadata } from 'oidc-provider';
import urlJoin from 'url-join';

import { appEnv } from '@/envs/app';

const marketBaseUrl = new URL(appEnv.MARKET_BASE_URL ?? 'https://market.lobehub.com').origin;

/**
 * Default OIDC client configuration
 */
export const defaultClients: ClientMetadata[] = [
  {
    application_type: 'web',
    client_id: 'lobehub-desktop',
    client_name: 'LobeHub Desktop',
    // Only supports authorization code flow
    grant_types: ['authorization_code', 'refresh_token'],

    logo_uri: 'https://hub-apac-1.lobeobjects.space/lobehub-desktop-icon.png',

    post_logout_redirect_uris: [
      // Dynamically construct web page callback URL
      urlJoin(appEnv.APP_URL!, '/oauth/logout'),
      'http://localhost:3210/oauth/logout',
    ],

    // Desktop authorization callback - changed to web page path
    redirect_uris: [
      // Dynamically construct web page callback URL
      urlJoin(appEnv.APP_URL!, '/oidc/callback/desktop'),
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
    client_name: 'LobeHub Mobile',
    // Supports authorization code flow and refresh token
    grant_types: ['authorization_code', 'refresh_token'],
    logo_uri: 'https://hub-apac-1.lobeobjects.space/docs/73f69adfa1b802a0e250f6ff9d62f70b.png',
    // Mobile does not need post_logout_redirect_uris as logout is typically handled within the app
    post_logout_redirect_uris: [],
    // Mobile uses custom URL Scheme
    redirect_uris: ['com.lobehub.app://auth/callback'],
    response_types: ['code'],
    // Public client with no secret
    token_endpoint_auth_method: 'none',
  },

  {
    application_type: 'web',
    client_id: 'lobehub-market',
    client_name: 'LobeHub Marketplace',
    grant_types: ['authorization_code', 'refresh_token'],
    logo_uri: 'https://hub-apac-1.lobeobjects.space/lobehub-desktop-icon.png',
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

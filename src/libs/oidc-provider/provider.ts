import { type LobeChatDatabase } from '@lobechat/database';
import debug from 'debug';
import { type Configuration, type KoaContextWithOIDC } from 'oidc-provider';
import Provider, { errors } from 'oidc-provider';
import urlJoin from 'url-join';

import { serverDBEnv } from '@/config/db';
import { UserModel } from '@/database/models/user';
import { appEnv } from '@/envs/app';
import { getJWKS } from '@/libs/oidc-provider/jwt';
import { normalizeLocale } from '@/locales/resources';

import { DrizzleAdapter } from './adapter';
import { defaultClaims, defaultClients, defaultScopes } from './config';
import { createInteractionPolicy } from './interaction-policy';

const logProvider = debug('lobe-oidc:provider');

export const API_AUDIENCE = 'urn:lobehub:chat';

/**
 * Get cookie keys using KEY_VAULTS_SECRET
 */
const getCookieKeys = () => {
  const key = serverDBEnv.KEY_VAULTS_SECRET;
  if (!key) {
    throw new Error('KEY_VAULTS_SECRET is required for OIDC Provider cookie encryption');
  }
  return [key];
};

/**
 * Create OIDC Provider instance
 * @param db - Database instance
 * @returns Configured OIDC Provider instance
 */
export const createOIDCProvider = async (db: LobeChatDatabase): Promise<Provider> => {
  // Get JWKS
  const jwks = getJWKS();

  const cookieKeys = getCookieKeys();

  const configuration: Configuration = {
    // 11. Database adapter
    adapter: DrizzleAdapter.createAdapterFactory(db),

    // 4. Claims definition
    claims: defaultClaims,

    // Added: client-based CORS control logic
    clientBasedCORS(ctx, origin, client) {
      // Check if the client allows this origin
      // A common strategy is to allow origins of all registered redirect_uris
      if (!client || !client.redirectUris) {
        logProvider('clientBasedCORS: No client or redirectUris found, denying origin: %s', origin);
        return false; // Deny if no client or redirect URIs
      }

      const allowed = client.redirectUris.some((uri) => {
        try {
          // Compare origins (scheme, hostname, port)
          return new URL(uri).origin === origin;
        } catch {
          // Skip if redirect_uri is not a valid URL (e.g. custom protocol)
          return false;
        }
      });

      logProvider(
        'clientBasedCORS check for origin [%s] and client [%s]: %s',
        origin,
        client.clientId,
        allowed ? 'Allowed' : 'Denied',
      );
      return allowed;
    },

    // 1. Client configuration
    clients: defaultClients,

    // Added: ensure ID Token includes claims for all scopes, not just openid scope
    conformIdTokenClaims: false,

    // 7. Cookie configuration
    cookies: {
      keys: cookieKeys,
      long: { path: '/', signed: true },
      short: { path: '/', signed: true },
    },

    // 5. Features configuration
    features: {
      backchannelLogout: { enabled: true },
      clientCredentials: { enabled: false },
      devInteractions: { enabled: false },
      deviceFlow: { enabled: false },
      introspection: { enabled: true },
      resourceIndicators: {
        defaultResource: () => API_AUDIENCE,
        enabled: true,

        getResourceServerInfo: (ctx, resourceIndicator) => {
          logProvider('getResourceServerInfo called with indicator: %s', resourceIndicator); // <-- Add this log line
          if (resourceIndicator === API_AUDIENCE) {
            logProvider('Indicator matches API_AUDIENCE, returning JWT config.'); // <-- Add this log line
            return {
              accessTokenFormat: 'jwt',
              audience: API_AUDIENCE,
              scope: ctx.oidc.client?.scope || 'read',
            };
          }

          logProvider('Indicator does not match API_AUDIENCE, throwing InvalidTarget.'); // <-- Add this log line
          throw new errors.InvalidTarget();
        },
        // When a client uses a refresh token to request a new access token without specifying a resource, the authorization server checks all resources included in the original authorization and uses them for the new access token. This provides a convenient way to maintain authorization consistency without requiring the client to re-specify all resources on each refresh.
        useGrantedResource: () => true,
      },
      revocation: { enabled: true },
      rpInitiatedLogout: { enabled: true },
      userinfo: { enabled: true },
    },
    // 10. Account lookup
    async findAccount(ctx: KoaContextWithOIDC, id: string) {
      logProvider('findAccount called for id: %s', id);

      // Check if there is a pre-stored external account ID
      // @ts-ignore - Custom property
      const externalAccountId = ctx.externalAccountId;
      if (externalAccountId) {
        logProvider('Found externalAccountId in context: %s', externalAccountId);
      }

      // Determine the account ID to look up
      // Priority: 1. externalAccountId 2. ctx.oidc.session?.accountId 3. passed-in id
      const accountIdToFind = externalAccountId || ctx.oidc?.session?.accountId || id;

      const clientId = ctx.oidc?.client?.clientId;

      logProvider('OIDC request client id: %s', clientId);

      logProvider(
        'Attempting to find account with ID: %s (source: %s)',
        accountIdToFind,
        externalAccountId
          ? 'externalAccountId'
          : ctx.oidc?.session?.accountId
            ? 'oidc_session'
            : 'parameter_id',
      );

      // Return undefined if no account ID is available
      if (!accountIdToFind) {
        logProvider('findAccount: No account ID available, returning undefined.');
        return undefined;
      }

      try {
        const user = await UserModel.findById(db, accountIdToFind);
        logProvider(
          'UserModel.findById result for %s: %O',
          accountIdToFind,
          user ? { id: user.id, name: user.username } : null,
        );

        if (!user) {
          logProvider('No user found for accountId: %s', accountIdToFind);
          return undefined;
        }

        return {
          accountId: user.id,
          async claims(use, scope): Promise<{ [key: string]: any; sub: string }> {
            logProvider('claims function called for user %s with scope: %s', user.id, scope);
            const claims: { [key: string]: any; sub: string } = {
              sub: user.id,
            };

            if (scope.includes('profile')) {
              claims.name =
                user.fullName ||
                user.username ||
                `${user.firstName || ''} ${user.lastName || ''}`.trim();
              claims.picture = user.avatar;
            }

            if (scope.includes('email')) {
              claims.email = user.email;
              claims.email_verified = !!user.emailVerifiedAt;
            }

            logProvider('Returning claims: %O', claims);
            return claims;
          },
        };
      } catch (error) {
        logProvider('Error finding account or generating claims: %O', error);
        console.error('Error finding account:', error);
        return undefined;
      }
    },

    // 9. Interaction policy
    interactions: {
      policy: createInteractionPolicy(),
      url(ctx, interaction) {
        // ---> Add logs <---
        logProvider('interactions.url function called');
        logProvider('Interaction details: %O', interaction);

        // Read the ui_locales parameter from the OIDC request (space-separated language priorities)
        // https://openid.net/specs/openid-connect-core-1_0.html#AuthRequest
        const uiLocalesRaw = (interaction.params?.ui_locales || ctx.oidc?.params?.ui_locales) as
          | string
          | undefined;

        let query = '';
        if (uiLocalesRaw) {
          // Take the first priority language and normalize it to a site-supported tag
          const first = uiLocalesRaw.split(/[\s,]+/).find(Boolean);
          const hl = normalizeLocale(first);
          query = `?hl=${encodeURIComponent(hl)}`;
          logProvider('Detected ui_locales=%s -> using hl=%s', uiLocalesRaw, hl);
        } else {
          logProvider('No ui_locales provided in authorization request');
        }

        const interactionUrl = `/oauth/consent/${interaction.uid}${query}`;
        logProvider('Generated interaction URL: %s', interactionUrl);
        // ---> End of added logs <---
        return interactionUrl;
      },
    },

    // 6. Key configuration - using RS256 JWKS
    jwks: jwks as { keys: any[] },

    // 2. PKCE configuration
    pkce: {
      required: () => true,
    },

    // 12. Other configuration
    renderError: async (ctx, out, error) => {
      ctx.type = 'html';
      ctx.body = `
        <html>
          <head>
            <title>LobeHub OIDC Error</title>
          </head>
          <body>
            <h1>LobeHub OIDC Error</h1>
            <p>${JSON.stringify(error, null, 2)}</p>
            <p>${JSON.stringify(out, null, 2)}</p>
          </body>
        </html>
      `;
    },

    // Added: enable refresh token rotation
    rotateRefreshToken: true,

    routes: {
      authorization: '/oidc/auth',
      end_session: '/oidc/session/end',
      token: '/oidc/token',
    },
    // 3. Scopes definition
    scopes: defaultScopes,

    // 8. Token TTL
    ttl: {
      AccessToken: 7 * 24 * 3600, // 7 days
      AuthorizationCode: 600, // 10 minutes
      DeviceCode: 600, // 10 minutes (if enabled)

      IdToken: 3600, // 1 hour
      Interaction: 3600, // 1 hour

      RefreshToken: 30 * 24 * 60 * 60, // 30 days
      Session: 30 * 24 * 60 * 60, // 30 days
    },
  };

  // Create provider instance
  const baseUrl = urlJoin(appEnv.APP_URL!, '/oidc');

  const provider = new Provider(baseUrl, configuration);
  provider.proxy = true;

  provider.on('server_error', (ctx, err) => {
    logProvider('OIDC Provider Server Error: %O', err); // Use logProvider
    console.error('OIDC Provider Error:', err);
  });

  provider.on('authorization.success', (ctx) => {
    logProvider('Authorization successful for client: %s', ctx.oidc.client?.clientId); // Use logProvider
  });

  return provider;
};

export { type default as OIDCProvider } from 'oidc-provider';

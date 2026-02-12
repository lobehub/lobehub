import { type GenericOAuthConfig } from 'better-auth/plugins';
import { type SocialProviders } from 'better-auth/social-providers';

import { appEnv } from '@/envs/app';
import { authEnv } from '@/envs/auth';
import { BUILTIN_BETTER_AUTH_PROVIDERS } from '@/libs/better-auth/constants';
import { parseSSOProviders } from '@/libs/better-auth/utils/server';

import Apple from './providers/apple';
import Auth0 from './providers/auth0';
import Authelia from './providers/authelia';
import Authentik from './providers/authentik';
import Casdoor from './providers/casdoor';
import CloudflareZeroTrust from './providers/cloudflare-zero-trust';
import Cognito from './providers/cognito';
import Feishu from './providers/feishu';
import GenericOIDC from './providers/generic-oidc';
import Github from './providers/github';
import Google from './providers/google';
import Keycloak from './providers/keycloak';
import Logto from './providers/logto';
import Microsoft from './providers/microsoft';
import Okta from './providers/okta';
import Wechat from './providers/wechat';
import Zitadel from './providers/zitadel';

const providerDefinitions = [
  Apple,
  Google,
  Github,
  Cognito,
  Microsoft,
  Auth0,
  Authelia,
  Authentik,
  Casdoor,
  CloudflareZeroTrust,
  GenericOIDC,
  Keycloak,
  Logto,
  Okta,
  Zitadel,
  Feishu,
  Wechat,
] as const;

const builtInProviderIds = new Set(BUILTIN_BETTER_AUTH_PROVIDERS);

for (const definition of providerDefinitions) {
  if (definition.type === 'builtin' && !builtInProviderIds.has(definition.id)) {
    throw new Error(
      `[Better-Auth] Built-in provider "${definition.id}" is not registered in BUILTIN_BETTER_AUTH_PROVIDERS (src/libs/better-auth/constants.ts). Please update the constant to keep them in sync.`,
    );
  }
}

const providerRegistry = new Map<string, (typeof providerDefinitions)[number]>();

for (const definition of providerDefinitions) {
  providerRegistry.set(definition.id, definition);
  definition.aliases?.forEach((alias) => providerRegistry.set(alias, definition));
}

export const initBetterAuthSSOProviders = () => {
  const enabledProviders = parseSSOProviders(authEnv.AUTH_SSO_PROVIDERS);

  const socialProviders: SocialProviders = {};
  const genericOAuthProviders: GenericOAuthConfig[] = [];

  for (const rawProvider of enabledProviders) {
    const definition = providerRegistry.get(rawProvider);

    if (!definition) {
      throw new Error(`[Better-Auth] Unknown SSO provider: ${rawProvider}`);
    }

    /**
     * Providers expose checkEnvs predicates so we can fail fast when credentials are missing instead
     * of encountering harder-to-trace errors later in the Better-Auth pipeline.
     */
    const env = definition.checkEnvs();
    if (!env) {
      throw new Error(
        `[Better-Auth] ${rawProvider} SSO provider environment variables are not set correctly!`,
      );
    }

    if (definition.type === 'builtin') {
      const providerId = definition.id;
      if (socialProviders[providerId]) {
        throw new Error(`[Better-Auth] Duplicate SSO provider: ${providerId}`);
      }

      // @ts-expect-error - build expects specific env type, but we use union definition type
      const config = definition.build(env);
      if (config) {
        // @ts-expect-error hard to type
        socialProviders[providerId] = config;
      }

      continue;
    }

    // @ts-expect-error - build expects specific env type, but we use union definition type
    const config = definition.build(env);

    if (config) {
      // the generic oidc callback url is /api/auth/oauth2/callback/{providerId}
      // different from builtin providers' /api/auth/callback/{providerId}
      config.redirectURI = `${appEnv.APP_URL}/api/auth/callback/${definition.id}`;
      genericOAuthProviders.push(config);
    }
  }

  return {
    genericOAuthProviders,
    socialProviders: socialProviders,
  };
};

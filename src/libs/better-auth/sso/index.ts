import type { GenericOAuthConfig } from 'better-auth/plugins';
import type { SocialProviders } from 'better-auth/social-providers';

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
import type { BuiltinProviderDefinition, GenericProviderDefinition } from './types';

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

/**
 * Binds the env (E) and config (R) type parameters within a single call so that
 * `build(checkEnvs())` type-checks. The provider registry stores a union of provider
 * definitions whose `build`/`checkEnvs` are only correlated within a single member, so
 * resolving them through this helper keeps the call site fully typed without suppressions.
 */
const resolveProviderConfig = <E extends Record<string, string | undefined>, R>(
  definition: { build: (env: E) => R; checkEnvs: () => E | false },
  rawProvider: string,
): R => {
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

  return definition.build(env);
};

/** Binds the provider id to its matching config type so the indexed write is type-safe. */
const assignSocialProvider = <Id extends keyof SocialProviders>(
  providers: SocialProviders,
  id: Id,
  config: SocialProviders[Id],
): void => {
  providers[id] = config;
};

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

    if (definition.type === 'builtin') {
      // The registry stores the union of specific provider definitions; narrow to the base
      // shape so `build`/`checkEnvs` share a single env type and resolve through the helper.
      const builtinDefinition = definition as unknown as BuiltinProviderDefinition<
        Record<string, string | undefined>
      >;
      const providerId = builtinDefinition.id;
      if (socialProviders[providerId]) {
        throw new Error(`[Better-Auth] Duplicate SSO provider: ${providerId}`);
      }

      const config = resolveProviderConfig(builtinDefinition, rawProvider);
      if (config) {
        assignSocialProvider(socialProviders, providerId, config);
      }

      continue;
    }

    const genericDefinition = definition as unknown as GenericProviderDefinition<
      Record<string, string | undefined>
    >;
    const config = resolveProviderConfig(genericDefinition, rawProvider);

    if (config) {
      // the generic oidc callback url is /api/auth/oauth2/callback/{providerId}
      // different from builtin providers' /api/auth/callback/{providerId}
      config.redirectURI = `${appEnv.APP_URL}/api/auth/callback/${genericDefinition.id}`;
      genericOAuthProviders.push(config);
    }
  }

  return {
    genericOAuthProviders,
    socialProviders,
  };
};

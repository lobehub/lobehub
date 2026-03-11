import { type GenericOAuthConfig } from 'better-auth/plugins';
import { type SocialProviders } from 'better-auth/social-providers';

export type BuiltinProviderDefinition<
  E extends Record<string, string | undefined>,
  Id extends keyof SocialProviders = keyof SocialProviders,
> = {
  aliases?: string[];
  build: (env: E) => SocialProviders[Id];
  checkEnvs: () => E | false;
  id: Id;
  type: 'builtin';
};

export type GenericProviderDefinition<E extends Record<string, string | undefined>> = {
  aliases?: string[];
  build: (env: E) => GenericOAuthConfig;
  checkEnvs: () => E | false;
  id: string;
  type: 'generic';
};

export type BetterAuthProviderDefinition =
  | BuiltinProviderDefinition<Record<string, string | undefined>>
  | GenericProviderDefinition<Record<string, string | undefined>>;

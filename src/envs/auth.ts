/* eslint-disable sort-keys-fix/sort-keys-fix , typescript-sort-keys/interface */
import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace NodeJS {
    interface ProcessEnv {
      // ===== Clerk ===== //
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?: string;
      CLERK_SECRET_KEY?: string;
      CLERK_WEBHOOK_SECRET?: string;

      // ===== Auth (shared by Better Auth / Next Auth) ===== //
      AUTH_SECRET?: string;
      AUTH_EMAIL_VERIFICATION?: string;
      ENABLE_MAGIC_LINK?: string;
      AUTH_SSO_PROVIDERS?: string;
      AUTH_TRUSTED_ORIGINS?: string;

      // ===== Next Auth ===== //
      NEXT_AUTH_SECRET?: string;

      NEXT_AUTH_SSO_PROVIDERS?: string;

      NEXT_AUTH_DEBUG?: string;

      NEXT_AUTH_SSO_SESSION_STRATEGY?: string;

      // ===== Next Auth Provider Credentials ===== //
      AUTH_GOOGLE_ID?: string;
      AUTH_GOOGLE_SECRET?: string;

      AUTH_APPLE_CLIENT_ID?: string;
      AUTH_APPLE_CLIENT_SECRET?: string;
      AUTH_APPLE_APP_BUNDLE_IDENTIFIER?: string;

      AUTH_GITHUB_ID?: string;
      AUTH_GITHUB_SECRET?: string;

      AUTH_COGNITO_ID?: string;
      AUTH_COGNITO_SECRET?: string;
      AUTH_COGNITO_ISSUER?: string;
      AUTH_COGNITO_DOMAIN?: string;
      AUTH_COGNITO_REGION?: string;
      AUTH_COGNITO_USERPOOL_ID?: string;

      AUTH_MICROSOFT_ID?: string;
      AUTH_MICROSOFT_SECRET?: string;

      AUTH_AUTH0_ID?: string;
      AUTH_AUTH0_SECRET?: string;
      AUTH_AUTH0_ISSUER?: string;

      AUTH_AUTHELIA_ID?: string;
      AUTH_AUTHELIA_SECRET?: string;
      AUTH_AUTHELIA_ISSUER?: string;

      AUTH_AUTHENTIK_ID?: string;
      AUTH_AUTHENTIK_SECRET?: string;
      AUTH_AUTHENTIK_ISSUER?: string;

      AUTH_CASDOOR_ID?: string;
      AUTH_CASDOOR_SECRET?: string;
      AUTH_CASDOOR_ISSUER?: string;

      AUTH_CLOUDFLARE_ZERO_TRUST_ID?: string;
      AUTH_CLOUDFLARE_ZERO_TRUST_SECRET?: string;
      AUTH_CLOUDFLARE_ZERO_TRUST_ISSUER?: string;

      AUTH_FEISHU_APP_ID?: string;
      AUTH_FEISHU_APP_SECRET?: string;

      AUTH_GENERIC_OIDC_ID?: string;
      AUTH_GENERIC_OIDC_SECRET?: string;
      AUTH_GENERIC_OIDC_ISSUER?: string;

      AUTH_KEYCLOAK_ID?: string;
      AUTH_KEYCLOAK_SECRET?: string;
      AUTH_KEYCLOAK_ISSUER?: string;

      AUTH_LOGTO_ID?: string;
      AUTH_LOGTO_SECRET?: string;
      AUTH_LOGTO_ISSUER?: string;

      AUTH_MICROSOFT_ENTRA_ID_ID?: string;
      AUTH_MICROSOFT_ENTRA_ID_SECRET?: string;
      AUTH_MICROSOFT_ENTRA_ID_TENANT_ID?: string;
      AUTH_MICROSOFT_ENTRA_ID_BASE_URL?: string;

      AUTH_OKTA_ID?: string;
      AUTH_OKTA_SECRET?: string;
      AUTH_OKTA_ISSUER?: string;

      AUTH_WECHAT_ID?: string;
      AUTH_WECHAT_SECRET?: string;

      AUTH_ZITADEL_ID?: string;
      AUTH_ZITADEL_SECRET?: string;
      AUTH_ZITADEL_ISSUER?: string;

      AUTH_AZURE_AD_ID?: string;
      AUTH_AZURE_AD_SECRET?: string;
      AUTH_AZURE_AD_TENANT_ID?: string;

      AZURE_AD_CLIENT_ID?: string;
      AZURE_AD_CLIENT_SECRET?: string;
      AZURE_AD_TENANT_ID?: string;

      // ZITADEL
      ZITADEL_CLIENT_ID?: string;
      ZITADEL_CLIENT_SECRET?: string;
      ZITADEL_ISSUER?: string;

      // ===== JWKS Key ===== //
      /**
       * Generic JWKS key for signing/verifying JWTs.
       * Used for internal service authentication and other cryptographic operations.
       * Must be a JWKS JSON string containing an RS256 RSA key pair.
       * Can be generated using `node scripts/generate-oidc-jwk.mjs`.
       */
      JWKS_KEY?: string;

      /**
       * Internal JWT expiration time for lambda → async calls.
       * Format: number followed by unit (s=seconds, m=minutes, h=hours)
       * Examples: '10s', '1m', '1h'
       * Should be as short as possible for security, but long enough to account for network latency and server processing time.
       * @default '30s'
       */
      INTERNAL_JWT_EXPIRATION?: string;
    }
  }
}

export const getAuthConfig = () => {
  return createEnv({
    client: {
      // ---------------------------------- clerk ----------------------------------
      NEXT_PUBLIC_ENABLE_CLERK_AUTH: z.boolean().optional().default(false),
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().optional(),

      // ---------------------------------- better auth ----------------------------------
      NEXT_PUBLIC_ENABLE_BETTER_AUTH: z.boolean().optional(),

      // ---------------------------------- next auth ----------------------------------
      NEXT_PUBLIC_ENABLE_NEXT_AUTH: z.boolean().optional(),
    },
    server: {
      // ---------------------------------- clerk ----------------------------------
      CLERK_SECRET_KEY: z.string().optional(),
      CLERK_WEBHOOK_SECRET: z.string().optional(),

      // ---------------------------------- better auth ----------------------------------
      AUTH_SECRET: z.string().optional(),
      AUTH_SSO_PROVIDERS: z.string().optional().default(''),
      AUTH_TRUSTED_ORIGINS: z.string().optional(),
      AUTH_EMAIL_VERIFICATION: z.boolean().optional().default(false),
      ENABLE_MAGIC_LINK: z.boolean().optional().default(false),

      // ---------------------------------- next auth ----------------------------------
      NEXT_AUTH_SECRET: z.string().optional(),
      NEXT_AUTH_SSO_PROVIDERS: z.string().optional().default('auth0'),
      NEXT_AUTH_DEBUG: z.boolean().optional().default(false),
      NEXT_AUTH_SSO_SESSION_STRATEGY: z.enum(['jwt', 'database']).optional().default('jwt'),

      AUTH_GOOGLE_ID: z.string().optional(),
      AUTH_GOOGLE_SECRET: z.string().optional(),

      AUTH_APPLE_CLIENT_ID: z.string().optional(),
      AUTH_APPLE_CLIENT_SECRET: z.string().optional(),
      AUTH_APPLE_APP_BUNDLE_IDENTIFIER: z.string().optional(),

      AUTH_GITHUB_ID: z.string().optional(),
      AUTH_GITHUB_SECRET: z.string().optional(),

      AUTH_COGNITO_ID: z.string().optional(),
      AUTH_COGNITO_SECRET: z.string().optional(),
      AUTH_COGNITO_ISSUER: z.string().optional(),
      AUTH_COGNITO_DOMAIN: z.string().optional(),
      AUTH_COGNITO_REGION: z.string().optional(),
      AUTH_COGNITO_USERPOOL_ID: z.string().optional(),

      AUTH_MICROSOFT_ID: z.string().optional(),
      AUTH_MICROSOFT_SECRET: z.string().optional(),

      AUTH_AUTH0_ID: z.string().optional(),
      AUTH_AUTH0_SECRET: z.string().optional(),
      AUTH_AUTH0_ISSUER: z.string().optional(),

      AUTH_AUTHELIA_ID: z.string().optional(),
      AUTH_AUTHELIA_SECRET: z.string().optional(),
      AUTH_AUTHELIA_ISSUER: z.string().optional(),

      AUTH_AUTHENTIK_ID: z.string().optional(),
      AUTH_AUTHENTIK_SECRET: z.string().optional(),
      AUTH_AUTHENTIK_ISSUER: z.string().optional(),

      AUTH_CASDOOR_ID: z.string().optional(),
      AUTH_CASDOOR_SECRET: z.string().optional(),
      AUTH_CASDOOR_ISSUER: z.string().optional(),

      AUTH_CLOUDFLARE_ZERO_TRUST_ID: z.string().optional(),
      AUTH_CLOUDFLARE_ZERO_TRUST_SECRET: z.string().optional(),
      AUTH_CLOUDFLARE_ZERO_TRUST_ISSUER: z.string().optional(),

      AUTH_FEISHU_APP_ID: z.string().optional(),
      AUTH_FEISHU_APP_SECRET: z.string().optional(),

      AUTH_GENERIC_OIDC_ID: z.string().optional(),
      AUTH_GENERIC_OIDC_SECRET: z.string().optional(),
      AUTH_GENERIC_OIDC_ISSUER: z.string().optional(),

      AUTH_KEYCLOAK_ID: z.string().optional(),
      AUTH_KEYCLOAK_SECRET: z.string().optional(),
      AUTH_KEYCLOAK_ISSUER: z.string().optional(),

      AUTH_LOGTO_ID: z.string().optional(),
      AUTH_LOGTO_SECRET: z.string().optional(),
      AUTH_LOGTO_ISSUER: z.string().optional(),

      AUTH_MICROSOFT_ENTRA_ID_ID: z.string().optional(),
      AUTH_MICROSOFT_ENTRA_ID_SECRET: z.string().optional(),
      AUTH_MICROSOFT_ENTRA_ID_TENANT_ID: z.string().optional(),
      AUTH_MICROSOFT_ENTRA_ID_BASE_URL: z.string().optional(),

      AUTH_OKTA_ID: z.string().optional(),
      AUTH_OKTA_SECRET: z.string().optional(),
      AUTH_OKTA_ISSUER: z.string().optional(),

      AUTH_WECHAT_ID: z.string().optional(),
      AUTH_WECHAT_SECRET: z.string().optional(),

      AUTH_ZITADEL_ID: z.string().optional(),
      AUTH_ZITADEL_SECRET: z.string().optional(),
      AUTH_ZITADEL_ISSUER: z.string().optional(),

      AUTH_AZURE_AD_ID: z.string().optional(),
      AUTH_AZURE_AD_SECRET: z.string().optional(),
      AUTH_AZURE_AD_TENANT_ID: z.string().optional(),

      AZURE_AD_CLIENT_ID: z.string().optional(),
      AZURE_AD_CLIENT_SECRET: z.string().optional(),
      AZURE_AD_TENANT_ID: z.string().optional(),

      ZITADEL_CLIENT_ID: z.string().optional(),
      ZITADEL_CLIENT_SECRET: z.string().optional(),
      ZITADEL_ISSUER: z.string().optional(),

      LOGTO_WEBHOOK_SIGNING_KEY: z.string().optional(),

      // Casdoor
      CASDOOR_WEBHOOK_SECRET: z.string().optional(),

      // Generic JWKS key for signing/verifying JWTs
      JWKS_KEY: z.string().optional(),
      ENABLE_OIDC: z.boolean(),

      // Internal JWT expiration time (e.g., '10s', '1m', '1h')
      INTERNAL_JWT_EXPIRATION: z.string().default('30s'),
    },

    runtimeEnv: {
      // Clerk
      NEXT_PUBLIC_ENABLE_CLERK_AUTH:
        process.env.NEXT_PUBLIC_ENABLE_CLERK_AUTH === '1' ||
        !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
      CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
      CLERK_WEBHOOK_SECRET: process.env.CLERK_WEBHOOK_SECRET,

      // ---------------------------------- better auth ----------------------------------
      NEXT_PUBLIC_ENABLE_BETTER_AUTH: process.env.NEXT_PUBLIC_ENABLE_BETTER_AUTH === '1',
      // Fallback to NEXT_PUBLIC_* for seamless migration
      AUTH_EMAIL_VERIFICATION:
        process.env.AUTH_EMAIL_VERIFICATION === '1' ||
        process.env.NEXT_PUBLIC_AUTH_EMAIL_VERIFICATION === '1',
      ENABLE_MAGIC_LINK:
        process.env.ENABLE_MAGIC_LINK === '1' || process.env.NEXT_PUBLIC_ENABLE_MAGIC_LINK === '1',
      // Fallback to NEXT_AUTH_SECRET for seamless migration from next-auth
      AUTH_SECRET: process.env.AUTH_SECRET || process.env.NEXT_AUTH_SECRET,
      // Fallback to NEXT_AUTH_SSO_PROVIDERS for seamless migration from next-auth
      AUTH_SSO_PROVIDERS: process.env.AUTH_SSO_PROVIDERS || process.env.NEXT_AUTH_SSO_PROVIDERS,
      AUTH_TRUSTED_ORIGINS: process.env.AUTH_TRUSTED_ORIGINS,

      // better-auth env for Cognito provider is different from next-auth's one
      AUTH_COGNITO_DOMAIN: process.env.AUTH_COGNITO_DOMAIN,
      AUTH_COGNITO_REGION: process.env.AUTH_COGNITO_REGION,
      AUTH_COGNITO_USERPOOL_ID: process.env.AUTH_COGNITO_USERPOOL_ID,

      // ---------------------------------- next auth ----------------------------------
      NEXT_PUBLIC_ENABLE_NEXT_AUTH: process.env.NEXT_PUBLIC_ENABLE_NEXT_AUTH === '1',
      NEXT_AUTH_SSO_PROVIDERS: process.env.NEXT_AUTH_SSO_PROVIDERS,
      NEXT_AUTH_SECRET: process.env.NEXT_AUTH_SECRET,
      NEXT_AUTH_DEBUG: !!process.env.NEXT_AUTH_DEBUG,
      NEXT_AUTH_SSO_SESSION_STRATEGY: process.env.NEXT_AUTH_SSO_SESSION_STRATEGY || 'jwt',

      // Next Auth Provider Credentials
      AUTH_GOOGLE_ID: process.env.AUTH_GOOGLE_ID,
      AUTH_GOOGLE_SECRET: process.env.AUTH_GOOGLE_SECRET,

      AUTH_APPLE_CLIENT_ID: process.env.AUTH_APPLE_CLIENT_ID,
      AUTH_APPLE_CLIENT_SECRET: process.env.AUTH_APPLE_CLIENT_SECRET,
      AUTH_APPLE_APP_BUNDLE_IDENTIFIER: process.env.AUTH_APPLE_APP_BUNDLE_IDENTIFIER,

      AUTH_GITHUB_ID: process.env.AUTH_GITHUB_ID,
      AUTH_GITHUB_SECRET: process.env.AUTH_GITHUB_SECRET,

      AUTH_MICROSOFT_ID: process.env.AUTH_MICROSOFT_ID,
      AUTH_MICROSOFT_SECRET: process.env.AUTH_MICROSOFT_SECRET,

      AUTH_COGNITO_ID: process.env.AUTH_COGNITO_ID,
      AUTH_COGNITO_SECRET: process.env.AUTH_COGNITO_SECRET,
      AUTH_COGNITO_ISSUER: process.env.AUTH_COGNITO_ISSUER,

      AUTH_AUTH0_ID: process.env.AUTH_AUTH0_ID,
      AUTH_AUTH0_SECRET: process.env.AUTH_AUTH0_SECRET,
      AUTH_AUTH0_ISSUER: process.env.AUTH_AUTH0_ISSUER,

      AUTH_AUTHELIA_ID: process.env.AUTH_AUTHELIA_ID,
      AUTH_AUTHELIA_SECRET: process.env.AUTH_AUTHELIA_SECRET,
      AUTH_AUTHELIA_ISSUER: process.env.AUTH_AUTHELIA_ISSUER,

      AUTH_AUTHENTIK_ID: process.env.AUTH_AUTHENTIK_ID,
      AUTH_AUTHENTIK_SECRET: process.env.AUTH_AUTHENTIK_SECRET,
      AUTH_AUTHENTIK_ISSUER: process.env.AUTH_AUTHENTIK_ISSUER,

      AUTH_CASDOOR_ID: process.env.AUTH_CASDOOR_ID,
      AUTH_CASDOOR_SECRET: process.env.AUTH_CASDOOR_SECRET,
      AUTH_CASDOOR_ISSUER: process.env.AUTH_CASDOOR_ISSUER,

      AUTH_CLOUDFLARE_ZERO_TRUST_ID: process.env.AUTH_CLOUDFLARE_ZERO_TRUST_ID,
      AUTH_CLOUDFLARE_ZERO_TRUST_SECRET: process.env.AUTH_CLOUDFLARE_ZERO_TRUST_SECRET,
      AUTH_CLOUDFLARE_ZERO_TRUST_ISSUER: process.env.AUTH_CLOUDFLARE_ZERO_TRUST_ISSUER,

      AUTH_FEISHU_APP_ID: process.env.AUTH_FEISHU_APP_ID,
      AUTH_FEISHU_APP_SECRET: process.env.AUTH_FEISHU_APP_SECRET,

      AUTH_GENERIC_OIDC_ID: process.env.AUTH_GENERIC_OIDC_ID,
      AUTH_GENERIC_OIDC_SECRET: process.env.AUTH_GENERIC_OIDC_SECRET,
      AUTH_GENERIC_OIDC_ISSUER: process.env.AUTH_GENERIC_OIDC_ISSUER,

      AUTH_KEYCLOAK_ID: process.env.AUTH_KEYCLOAK_ID,
      AUTH_KEYCLOAK_SECRET: process.env.AUTH_KEYCLOAK_SECRET,
      AUTH_KEYCLOAK_ISSUER: process.env.AUTH_KEYCLOAK_ISSUER,

      AUTH_LOGTO_ID: process.env.AUTH_LOGTO_ID,
      AUTH_LOGTO_SECRET: process.env.AUTH_LOGTO_SECRET,
      AUTH_LOGTO_ISSUER: process.env.AUTH_LOGTO_ISSUER,

      AUTH_MICROSOFT_ENTRA_ID_ID: process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
      AUTH_MICROSOFT_ENTRA_ID_SECRET: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
      AUTH_MICROSOFT_ENTRA_ID_TENANT_ID: process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID,
      AUTH_MICROSOFT_ENTRA_ID_BASE_URL: process.env.AUTH_MICROSOFT_ENTRA_ID_BASE_URL,

      AUTH_OKTA_ID: process.env.AUTH_OKTA_ID,
      AUTH_OKTA_SECRET: process.env.AUTH_OKTA_SECRET,
      AUTH_OKTA_ISSUER: process.env.AUTH_OKTA_ISSUER,

      AUTH_WECHAT_ID: process.env.AUTH_WECHAT_ID,
      AUTH_WECHAT_SECRET: process.env.AUTH_WECHAT_SECRET,

      AUTH_ZITADEL_ID: process.env.AUTH_ZITADEL_ID,
      AUTH_ZITADEL_SECRET: process.env.AUTH_ZITADEL_SECRET,
      AUTH_ZITADEL_ISSUER: process.env.AUTH_ZITADEL_ISSUER,

      AUTH_AZURE_AD_ID: process.env.AUTH_AZURE_AD_ID,
      AUTH_AZURE_AD_SECRET: process.env.AUTH_AZURE_AD_SECRET,
      AUTH_AZURE_AD_TENANT_ID: process.env.AUTH_AZURE_AD_TENANT_ID,

      // legacy Azure AD envs for backward compatibility
      AZURE_AD_CLIENT_ID: process.env.AZURE_AD_CLIENT_ID,
      AZURE_AD_CLIENT_SECRET: process.env.AZURE_AD_CLIENT_SECRET,
      AZURE_AD_TENANT_ID: process.env.AZURE_AD_TENANT_ID,

      ZITADEL_CLIENT_ID: process.env.ZITADEL_CLIENT_ID,
      ZITADEL_CLIENT_SECRET: process.env.ZITADEL_CLIENT_SECRET,
      ZITADEL_ISSUER: process.env.ZITADEL_ISSUER,

      // LOGTO
      LOGTO_WEBHOOK_SIGNING_KEY: process.env.LOGTO_WEBHOOK_SIGNING_KEY,

      // Casdoor
      CASDOOR_WEBHOOK_SECRET: process.env.CASDOOR_WEBHOOK_SECRET,

      // Generic JWKS key (fallback to OIDC_JWKS_KEY for backward compatibility)
      JWKS_KEY: process.env.JWKS_KEY || process.env.OIDC_JWKS_KEY,
      ENABLE_OIDC: !!(process.env.JWKS_KEY || process.env.OIDC_JWKS_KEY),

      // Internal JWT expiration time
      INTERNAL_JWT_EXPIRATION: process.env.INTERNAL_JWT_EXPIRATION,
    },
  });
};

export const authEnv = getAuthConfig();

// Auth flags - use process.env directly for build-time dead code elimination
export const enableClerk =
  process.env.NEXT_PUBLIC_ENABLE_CLERK_AUTH === '1'
    ? true
    : !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
export const enableBetterAuth = process.env.NEXT_PUBLIC_ENABLE_BETTER_AUTH === '1';
export const enableNextAuth = process.env.NEXT_PUBLIC_ENABLE_NEXT_AUTH === '1';
export const enableAuth = enableClerk || enableBetterAuth || enableNextAuth || false;

// Auth headers and constants
export const LOBE_CHAT_AUTH_HEADER = 'X-lobe-chat-auth';
export const LOBE_CHAT_OIDC_AUTH_HEADER = 'Oidc-Auth';
export const OAUTH_AUTHORIZED = 'X-oauth-authorized';
export const SECRET_XOR_KEY = 'LobeHub · LobeHub';

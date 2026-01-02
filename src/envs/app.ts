/* eslint-disable sort-keys-fix/sort-keys-fix */
import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace NodeJS {
    interface ProcessEnv {
      ACCESS_CODE?: string;
    }
  }
}
const isInVercel = process.env.VERCEL === '1';

const vercelUrl = `https://${process.env.VERCEL_URL}`;

const APP_URL = process.env.APP_URL
  ? process.env.APP_URL
  : isInVercel
    ? vercelUrl
    : process.env.NODE_ENV === 'development'
      ? 'http://localhost:3010'
      : 'http://localhost:3210';

// INTERNAL_APP_URL is used for server-to-server calls to bypass CDN/proxy
// Falls back to APP_URL if not set
const INTERNAL_APP_URL = process.env.INTERNAL_APP_URL || APP_URL;

const ASSISTANT_INDEX_URL = 'https://registry.npmmirror.com/@lobehub/agents-index/v1/files/public';

const PLUGINS_INDEX_URL = 'https://registry.npmmirror.com/@lobehub/plugins-index/v1/files/public';

export const getAppConfig = () => {
  const ACCESS_CODES = process.env.ACCESS_CODE?.split(',').filter(Boolean) || [];

  return createEnv({
    client: {
      NEXT_PUBLIC_ENABLE_SENTRY: z.boolean(),
    },
    server: {
      ACCESS_CODES: z.any(z.string()).optional(),
      AGENTS_INDEX_URL: z.string().url(),

      DEFAULT_AGENT_CONFIG: z.string(),
      SYSTEM_AGENT: z.string().optional(),

      PLUGINS_INDEX_URL: z.string().url(),
      PLUGIN_SETTINGS: z.string().optional(),

      APP_URL: z.string(),
      INTERNAL_APP_URL: z.string().optional(),
      VERCEL_EDGE_CONFIG: z.string().optional(),
      MIDDLEWARE_REWRITE_THROUGH_LOCAL: z.boolean().optional(),
      ENABLE_AUTH_PROTECTION: z.boolean().optional(),

      CDN_USE_GLOBAL: z.boolean().optional(),
      CUSTOM_FONT_FAMILY: z.string().optional(),
      CUSTOM_FONT_URL: z.string().optional(),

      SSRF_ALLOW_PRIVATE_IP_ADDRESS: z.boolean().optional(),
      SSRF_ALLOW_IP_ADDRESS_LIST: z.string().optional(),
      MARKET_BASE_URL: z.string().optional(),

      /**
       * Trusted Client Secret for Market API authentication
       * 64-character hex string (32 bytes) shared with Market server
       * Used to encrypt user payload for trusted client authentication
       * Generate with: openssl rand -hex 32
       */
      MARKET_TRUSTED_CLIENT_SECRET: z.string().length(83).optional(),
      /**
       * Trusted Client ID for Market API authentication
       * Must be registered in Market's TRUSTED_CLIENT_IDS whitelist
       * e.g., "lobechat-com", "lobehub-desktop"
       */
      MARKET_TRUSTED_CLIENT_ID: z.string().optional(),

      /**
       * Enable Queue-based Agent Runtime
       * When true, use QStash for async agent execution (production)
       * When false, execute agent steps synchronously in current process (development)
       * @default false
       */
      enableQueueAgentRuntime: z.boolean().optional(),
      TELEMETRY_DISABLED: z.boolean().optional(),
    },
    runtimeEnv: {
      // Sentry
      NEXT_PUBLIC_ENABLE_SENTRY: !!process.env.NEXT_PUBLIC_SENTRY_DSN,

      ACCESS_CODES: ACCESS_CODES as any,

      AGENTS_INDEX_URL: !!process.env.AGENTS_INDEX_URL
        ? process.env.AGENTS_INDEX_URL
        : ASSISTANT_INDEX_URL,

      DEFAULT_AGENT_CONFIG: process.env.DEFAULT_AGENT_CONFIG || '',
      SYSTEM_AGENT: process.env.SYSTEM_AGENT,

      PLUGINS_INDEX_URL: !!process.env.PLUGINS_INDEX_URL
        ? process.env.PLUGINS_INDEX_URL
        : PLUGINS_INDEX_URL,

      PLUGIN_SETTINGS: process.env.PLUGIN_SETTINGS,

      VERCEL_EDGE_CONFIG: process.env.VERCEL_EDGE_CONFIG,

      APP_URL,
      INTERNAL_APP_URL,
      MIDDLEWARE_REWRITE_THROUGH_LOCAL: process.env.MIDDLEWARE_REWRITE_THROUGH_LOCAL === '1',
      ENABLE_AUTH_PROTECTION: process.env.ENABLE_AUTH_PROTECTION === '1',

      CUSTOM_FONT_FAMILY: process.env.CUSTOM_FONT_FAMILY,
      CUSTOM_FONT_URL: process.env.CUSTOM_FONT_URL,
      CDN_USE_GLOBAL: process.env.CDN_USE_GLOBAL === '1',

      SSRF_ALLOW_PRIVATE_IP_ADDRESS: process.env.SSRF_ALLOW_PRIVATE_IP_ADDRESS === '1',
      SSRF_ALLOW_IP_ADDRESS_LIST: process.env.SSRF_ALLOW_IP_ADDRESS_LIST,
      MARKET_BASE_URL: process.env.MARKET_BASE_URL,

      MARKET_TRUSTED_CLIENT_SECRET: process.env.MARKET_TRUSTED_CLIENT_SECRET,
      MARKET_TRUSTED_CLIENT_ID: process.env.MARKET_TRUSTED_CLIENT_ID,

      enableQueueAgentRuntime: process.env.AGENT_RUNTIME_MODE === 'queue',
      TELEMETRY_DISABLED: process.env.TELEMETRY_DISABLED === '1',
    },
  });
};

export const appEnv = getAppConfig();

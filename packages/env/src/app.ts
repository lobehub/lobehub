import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

const isInVercel = process.env.VERCEL === '1';

// Vercel URL fallback order (by stability):
// 1. VERCEL_PROJECT_PRODUCTION_URL - project level, most stable
// 2. VERCEL_URL - deployment level, changes every deployment
// 3. VERCEL_BRANCH_URL - branch level, stable across deployments on same branch
const getVercelUrl = () => {
  if (process.env.VERCEL_ENV === 'production' && process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return `https://${process.env.VERCEL_BRANCH_URL}`;
};

const APP_URL =
  process.env.APP_URL ||
  (isInVercel
    ? getVercelUrl()
    : process.env.NODE_ENV === 'development'
      ? `http://localhost:${process.env.PORT || 3010}`
      : `http://localhost:${process.env.PORT || 3210}`);

// INTERNAL_APP_URL is used for server-to-server calls to bypass CDN/proxy
// Falls back to APP_URL if not set
const INTERNAL_APP_URL = process.env.INTERNAL_APP_URL || APP_URL;

const ASSISTANT_INDEX_URL = 'https://registry.npmmirror.com/@lobehub/agents-index/v1/files/public';

const PLUGINS_INDEX_URL = 'https://registry.npmmirror.com/@lobehub/plugins-index/v1/files/public';

export const getAppConfig = () => {
  return createEnv({
    clientPrefix: 'NEXT_PUBLIC_',
    client: {
      NEXT_PUBLIC_ENABLE_SENTRY: z.boolean(),
    },
    server: {
      AGENTS_INDEX_URL: z.string().url(),

      DEFAULT_AGENT_CONFIG: z.string(),
      SYSTEM_AGENT: z.string().optional(),

      PLUGINS_INDEX_URL: z.string().url(),
      PLUGIN_SETTINGS: z.string().optional(),

      APP_URL: z.string(),
      INTERNAL_APP_URL: z.string().optional(),
      VIDEO_GENERATION_PREFER_WEBHOOK: z.boolean().optional(),
      WEBHOOK_PROXY_URL: z.string().url().optional(),
      VERCEL_EDGE_CONFIG: z.string().optional(),
      MIDDLEWARE_REWRITE_THROUGH_LOCAL: z.boolean().optional(),

      CDN_USE_GLOBAL: z.boolean().optional(),
      CUSTOM_FONT_FAMILY: z.string().optional(),
      CUSTOM_FONT_URL: z.string().optional(),

      SSRF_ALLOW_PRIVATE_IP_ADDRESS: z.boolean().optional(),
      SSRF_ALLOW_IP_ADDRESS_LIST: z.string().optional(),

      MARKET_BASE_URL: z.string().optional(),
      MARKET_SKILL_INSTALL_BASE_URL: z.string().url().optional(),
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

      AGENT_GATEWAY_SERVICE_TOKEN: z.string().optional(),
      ENABLE_AGENT_GATEWAY: z.boolean().optional(),
      /**
       * Server-to-server Agent Gateway endpoint, e.g. a Docker Compose service
       * name the browser cannot resolve. Falls back to AGENT_GATEWAY_URL.
       */
      AGENT_GATEWAY_INTERNAL_URL: z.string().url().optional(),
      AGENT_GATEWAY_URL: z.string().url().optional(),

      /**
       * Bearer token for the admin panel and sandbox execution service to call
       * the `/api/governance/*` endpoints. Same pattern as
       * `AGENT_GATEWAY_SERVICE_TOKEN` — required (non-empty) for those routes to
       * accept requests.
       */
      COMMAND_GOVERNANCE_SERVICE_TOKEN: z.string().optional(),
      /** Shared Bearer token for Console to call /api/internal/control-plane/*. */
      LOBEHUB_CONTROL_PLANE_TOKEN: z.string().optional(),
      /**
       * Bearer token for trusted backends (e.g. the landing site) to call
       * /api/internal/tenant-discovery/*. Must be >= 32 chars and differ from
       * LOBEHUB_CONTROL_PLANE_TOKEN; otherwise the endpoint answers 503.
       */
      LOBEHUB_TENANT_DISCOVERY_TOKEN: z.string().optional(),

      /**
       * Where this deployment serves its own desktop installers.
       *
       * Env rather than a build-time constant on purpose: the URLs change
       * whenever the release hosting moves, and a deployment should not have to
       * rebuild its image to correct a download link. Set either one and the
       * product's "get the desktop app" entry points resolve to this
       * deployment's own `/downloads` page; leave both unset and nothing
       * changes.
       *
       * Add a platform by adding a variable here and a field in
       * `GlobalServerConfig['desktopDownloads']` — the page renders whatever it
       * is given.
       */
      DESKTOP_DOWNLOAD_URL_LINUX: z.string().url().optional(),
      DESKTOP_DOWNLOAD_URL_MACOS: z.string().url().optional(),
      DESKTOP_DOWNLOAD_URL_WINDOWS: z.string().url().optional(),
      /**
       * Which Agent Gateway wire protocol this deployment's gateway can serve.
       *
       * `2` means it exposes the per-user multiplexed socket (`GET /v2/ws`);
       * `1` means only the per-operation socket (`GET /ws`). Unset is resolved
       * from the build: business builds ship against the v2 gateway, every
       * other deployment gets 1, which is what `lobehub/lobehub-gateway`
       * serves. Set it explicitly when that guess is wrong — a client that
       * dials `/v2/ws` on a gateway without it has no stream until it has
       * burned its fallback budget on 404s.
       */
      AGENT_GATEWAY_PROTOCOL: z.coerce.number().int().min(1).max(2).optional(),
      /**
       * Enable Queue-based Agent Runtime
       * When true, run agent steps and background deliveries through Hatchet (production)
       * When false, execute agent steps synchronously in current process (development)
       * @default false
       */
      enableQueueAgentRuntime: z.boolean().optional(),
      TELEMETRY_DISABLED: z.boolean().optional(),
    },
    runtimeEnv: {
      // Sentry
      NEXT_PUBLIC_ENABLE_SENTRY: !!process.env.NEXT_PUBLIC_SENTRY_DSN,

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
      VIDEO_GENERATION_PREFER_WEBHOOK: process.env.VIDEO_GENERATION_PREFER_WEBHOOK === '1',
      WEBHOOK_PROXY_URL: process.env.WEBHOOK_PROXY_URL,
      MIDDLEWARE_REWRITE_THROUGH_LOCAL: process.env.MIDDLEWARE_REWRITE_THROUGH_LOCAL === '1',

      CUSTOM_FONT_FAMILY: process.env.CUSTOM_FONT_FAMILY,
      CUSTOM_FONT_URL: process.env.CUSTOM_FONT_URL,
      CDN_USE_GLOBAL: process.env.CDN_USE_GLOBAL === '1',

      SSRF_ALLOW_PRIVATE_IP_ADDRESS: process.env.SSRF_ALLOW_PRIVATE_IP_ADDRESS === '1',
      SSRF_ALLOW_IP_ADDRESS_LIST: process.env.SSRF_ALLOW_IP_ADDRESS_LIST,
      MARKET_BASE_URL: process.env.MARKET_BASE_URL,
      MARKET_SKILL_INSTALL_BASE_URL: process.env.MARKET_SKILL_INSTALL_BASE_URL || undefined,

      MARKET_TRUSTED_CLIENT_SECRET: process.env.MARKET_TRUSTED_CLIENT_SECRET,
      MARKET_TRUSTED_CLIENT_ID: process.env.MARKET_TRUSTED_CLIENT_ID,

      AGENT_GATEWAY_SERVICE_TOKEN: process.env.AGENT_GATEWAY_SERVICE_TOKEN,
      ENABLE_AGENT_GATEWAY: process.env.ENABLE_AGENT_GATEWAY === '1',
      AGENT_GATEWAY_URL: process.env.AGENT_GATEWAY_URL,
      AGENT_GATEWAY_PROTOCOL: process.env.AGENT_GATEWAY_PROTOCOL || undefined,
      AGENT_GATEWAY_INTERNAL_URL: process.env.AGENT_GATEWAY_INTERNAL_URL || undefined,
      COMMAND_GOVERNANCE_SERVICE_TOKEN: process.env.COMMAND_GOVERNANCE_SERVICE_TOKEN,
      LOBEHUB_CONTROL_PLANE_TOKEN: process.env.LOBEHUB_CONTROL_PLANE_TOKEN,
      LOBEHUB_TENANT_DISCOVERY_TOKEN: process.env.LOBEHUB_TENANT_DISCOVERY_TOKEN,
      DESKTOP_DOWNLOAD_URL_LINUX: process.env.DESKTOP_DOWNLOAD_URL_LINUX,
      DESKTOP_DOWNLOAD_URL_MACOS: process.env.DESKTOP_DOWNLOAD_URL_MACOS,
      DESKTOP_DOWNLOAD_URL_WINDOWS: process.env.DESKTOP_DOWNLOAD_URL_WINDOWS,
      enableQueueAgentRuntime: process.env.AGENT_RUNTIME_MODE === 'queue',
      TELEMETRY_DISABLED: process.env.TELEMETRY_DISABLED === '1',
    },
  });
};

export const appEnv = getAppConfig();

const trimTrailingSlash = (url: string): string => url.replace(/\/+$/, '');

/** Deployment base URL. Tenant paths are composed by @lobechat/business-tenant/routing. */
export const getAppOriginUrl = (): string => trimTrailingSlash(appEnv.APP_URL);

/**
 * Server-to-server base URL, preferring INTERNAL_APP_URL to bypass the CDN/proxy.
 * Tenant callbacks add their scope through the server's Tenant/callbackUrl module.
 */
export const getInternalApiUrl = (): string =>
  trimTrailingSlash(appEnv.INTERNAL_APP_URL || appEnv.APP_URL);

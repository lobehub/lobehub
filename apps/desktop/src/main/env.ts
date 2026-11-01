import { OFFICIAL_CLOUD_URL } from '@lobechat/const/url';
import { createEnv } from '@t3-oss/env-core';
import { memoize } from 'es-toolkit';
import { z } from 'zod';

const normalizeEnvString = (input: unknown) => {
  if (typeof input !== 'string') return undefined;
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  return trimmed;
};

const envBoolean = (defaultValue: boolean) =>
  z
    .preprocess((input) => {
      const str = normalizeEnvString(input);
      if (!str) return undefined;

      switch (str.toLowerCase()) {
        case '1':
        case 'true':
        case 'yes':
        case 'y':
        case 'on': {
          return true;
        }

        case '0':
        case 'false':
        case 'no':
        case 'n':
        case 'off': {
          return false;
        }

        default: {
          return undefined;
        }
      }
    }, z.boolean().optional())
    .default(defaultValue);

const envNumber = (defaultValue: number) =>
  z
    .preprocess((input) => {
      const str = normalizeEnvString(input);
      if (!str) return undefined;
      const num = Number(str);
      if (!Number.isFinite(num)) return undefined;
      return num;
    }, z.number().optional())
    .default(defaultValue);

const getRuntimeEnv = () => ({
  ...process.env,
  DESKTOP_APP_ID: process.env.DESKTOP_APP_ID,
  DESKTOP_BACKEND_PROXY_RETHROW_ERRORS: process.env.DESKTOP_BACKEND_PROXY_RETHROW_ERRORS,
  DESKTOP_EXTERNAL_NAVIGATION_HOSTS: process.env.DESKTOP_EXTERNAL_NAVIGATION_HOSTS,
  DESKTOP_PROTOCOL_SCHEME: process.env.DESKTOP_PROTOCOL_SCHEME,
  UPDATE_CHANNEL: process.env.UPDATE_CHANNEL,
  UPDATE_SERVER_URL: process.env.UPDATE_SERVER_URL,
});

/**
 * Desktop (Electron main process) runtime env access.
 *
 * Important:
 * - Keep schemas tolerant (optional + defaults) to avoid throwing in tests/dev.
 * - Prefer reading env at call-time (factory) so tests can mutate process.env safely.
 */
export const getDesktopEnv = memoize(() =>
  createEnv({
    client: {},
    clientPrefix: 'PUBLIC_',
    emptyStringAsUndefined: true,
    isServer: true,
    runtimeEnv: getRuntimeEnv(),
    server: {
      DEBUG_VERBOSE: envBoolean(false),

      // escape hatch: allow testing static renderer in dev via env
      DESKTOP_RENDERER_STATIC: envBoolean(false),

      // Dev-only failure injection: surface backend proxy errors as uncaught
      // main-process exceptions so Electron's default dialog can be reproduced.
      DESKTOP_BACKEND_PROXY_RETHROW_ERRORS: envBoolean(false),

      // Distribution identity, baked in at build time (vite.main.config.ts) and
      // read by electron-builder.mjs too — the two must agree.
      // Windows AppUserModelID; unset keeps upstream's.
      DESKTOP_APP_ID: z.string().optional(),

      DESKTOP_EXTERNAL_NAVIGATION_HOSTS: z.string().optional().default(''),

      // Deep-link / OAuth-handoff scheme the OS routes to this app; unset keeps
      // the channel-derived `lobehub*` scheme.
      DESKTOP_PROTOCOL_SCHEME: z.string().optional(),

      // device gateway url override (dev: point at a local `wrangler dev` instance,
      // e.g. http://localhost:8787). Falls back to the stored value, then the
      // production gateway.
      DEVICE_GATEWAY_URL: z.string().url().optional(),

      // Force use dev-app-update.yml even in packaged app (for testing updates)
      FORCE_DEV_UPDATE_CONFIG: envBoolean(false),

      // mcp client
      MCP_TOOL_TIMEOUT: envNumber(60_000),

      // keep optional to preserve existing behavior:
      // - unset NODE_ENV should behave like "not production" in logger runtime paths
      NODE_ENV: z.enum(['development', 'production', 'test']).optional(),

      // cloud server url (can be overridden for selfhost/dev)
      OFFICIAL_CLOUD_SERVER: z.string().optional().default(OFFICIAL_CLOUD_URL),

      // updater
      // process.env.xxx will replace in build stage
      UPDATE_CHANNEL: z.string().optional().default(process.env.UPDATE_CHANNEL),

      // Custom update server URL (for stable channel)
      // e.g., https://releases.lobehub.com/stable or https://your-bucket.s3.amazonaws.com/releases
      UPDATE_SERVER_URL: z.string().optional().default(process.env.UPDATE_SERVER_URL),

      // Vercel JWT for bypassing deployment protection (dev only)
      VERCEL_JWT: z.string().optional(),
    },
  }),
);

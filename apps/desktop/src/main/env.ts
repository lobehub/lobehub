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
    runtimeEnv: process.env,
    server: {
      DEBUG_VERBOSE: envBoolean(false),

      // escape hatch: allow testing static renderer in dev via env
      DESKTOP_RENDERER_STATIC: envBoolean(false),

      // Force use dev-app-update.yml even in packaged app (for testing updates)
      FORCE_DEV_UPDATE_CONFIG: envBoolean(false),

      // mcp client
      MCP_TOOL_TIMEOUT: envNumber(60_000),

      // keep optional to preserve existing behavior:
      // - unset NODE_ENV should behave like "not production" in logger runtime paths
      NODE_ENV: z.enum(['development', 'production', 'test']).optional(),

      // cloud server url (can be overridden for selfhost/dev)
      OFFICIAL_CLOUD_SERVER: z.string().optional().default('https://app.lobehub.com'),

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

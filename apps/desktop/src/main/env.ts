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
    server: {
      DEBUG_VERBOSE: envBoolean(false),

      // keep optional to preserve existing behavior:
      // - unset NODE_ENV should behave like "not production" in logger runtime paths
      NODE_ENV: z.enum(['development', 'production', 'test']).optional(),

      // escape hatch: allow testing static renderer in dev via env
      DESKTOP_RENDERER_STATIC: envBoolean(false),

      // updater
      UPDATE_CHANNEL: z.string().optional(),

      // mcp client
      MCP_TOOL_TIMEOUT: envNumber(60_000),

      // cloud server url (can be overridden for selfhost/dev)
      OFFICIAL_CLOUD_SERVER: z.string().optional().default('https://app.lobehub.com'),
    },
    clientPrefix: 'PUBLIC_',
    client: {},
    runtimeEnv: process.env,
    emptyStringAsUndefined: true,
    isServer: true,
  }),
);

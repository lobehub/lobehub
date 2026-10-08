import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

const emptyStringToUndefined = (value: unknown) => (value === '' ? undefined : value);

export const getSandboxConfig = () => {
  return createEnv({
    runtimeEnv: {
      ONLYBOXES_BASE_URL: process.env.ONLYBOXES_BASE_URL,
      ONLYBOXES_JIT_ISSUER: process.env.ONLYBOXES_JIT_ISSUER,
      ONLYBOXES_JIT_SIGNING_KEY: process.env.ONLYBOXES_JIT_SIGNING_KEY,
      ONLYBOXES_JIT_TTL_SEC: process.env.ONLYBOXES_JIT_TTL_SEC,
      ONLYBOXES_LEASE_TTL_SEC: process.env.ONLYBOXES_LEASE_TTL_SEC,
      SANDBOX_PROVIDER: process.env.SANDBOX_PROVIDER,
      WIDGET_SANDBOX_NETWORK_FORMAT: process.env.WIDGET_SANDBOX_NETWORK_FORMAT,
      WIDGET_SANDBOX_PROVIDER: process.env.WIDGET_SANDBOX_PROVIDER,
      // `DASHBOARD_SANDBOX_*` is the pre-rename name, still read as a fallback.
      WIDGET_SANDBOX_TOKEN: process.env.WIDGET_SANDBOX_TOKEN || process.env.DASHBOARD_SANDBOX_TOKEN,
      WIDGET_SANDBOX_URL: process.env.WIDGET_SANDBOX_URL || process.env.DASHBOARD_SANDBOX_URL,
    },
    server: {
      ONLYBOXES_BASE_URL: z.preprocess(emptyStringToUndefined, z.string().url().optional()),
      ONLYBOXES_JIT_ISSUER: z.preprocess(emptyStringToUndefined, z.string().optional()),
      ONLYBOXES_JIT_SIGNING_KEY: z.preprocess(emptyStringToUndefined, z.string().optional()),
      ONLYBOXES_JIT_TTL_SEC: z.preprocess(
        emptyStringToUndefined,
        z.coerce.number().int().positive().optional(),
      ),
      ONLYBOXES_LEASE_TTL_SEC: z.preprocess(emptyStringToUndefined, z.coerce.number().optional()),
      SANDBOX_PROVIDER: z.preprocess(
        emptyStringToUndefined,
        z.enum(['market', 'onlyboxes']).optional(),
      ),
      /**
       * How the widget sandbox request encodes the manifest's network
       * allowlist: `boolean` (default) sends `network: allow.length > 0`, which is
       * all the deployed Worker understands today (it rejects an object with 400);
       * `allowlist` sends `network: { allow: [...] }` for a Worker that enforces
       * per-run hosts.
       */
      WIDGET_SANDBOX_NETWORK_FORMAT: z.preprocess(
        emptyStringToUndefined,
        z.enum(['allowlist', 'boolean']).optional(),
      ),
      /** Widget script executor; only the Cloudflare Worker exists today. */
      WIDGET_SANDBOX_PROVIDER: z.preprocess(
        emptyStringToUndefined,
        z.enum(['cloudflare-worker']).optional(),
      ),
      /** Bearer token for the widget sandbox (`POST /run`). Falls back to `DASHBOARD_SANDBOX_TOKEN`. */
      WIDGET_SANDBOX_TOKEN: z.preprocess(emptyStringToUndefined, z.string().optional()),
      /** Base URL of the widget sandbox. Falls back to `DASHBOARD_SANDBOX_URL`. */
      WIDGET_SANDBOX_URL: z.preprocess(emptyStringToUndefined, z.string().url().optional()),
    },
  });
};

export const sandboxEnv = getSandboxConfig();

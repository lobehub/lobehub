import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

export const getComposioConfig = () => {
  return createEnv({
    client: {},
    runtimeEnv: {
      COMPOSIO_API_KEY: process.env.COMPOSIO_API_KEY,
      COMPOSIO_AUTH_CONFIG_IDS: process.env.COMPOSIO_AUTH_CONFIG_IDS,
    },
    server: {
      COMPOSIO_API_KEY: z.string().optional(),
      /**
       * JSON map of `identifier -> authConfigId`, pinning a pre-created (e.g.
       * custom/white-label) Composio auth config per toolkit. Example:
       * `{"gmail":"ac_rc8q_6L4kL-I","google-calendar":"ac_..."}`.
       * When an identifier is present here, that auth config is used directly
       * instead of auto-creating a Composio-managed one.
       */
      COMPOSIO_AUTH_CONFIG_IDS: z.string().optional(),
    },
  });
};

export const composioEnv = getComposioConfig();

export const getServerComposioApiKey = (): string | undefined => {
  if (typeof window !== 'undefined') {
    console.error('[Composio] Attempted to access API key from client-side!');
    return undefined;
  }
  return composioEnv.COMPOSIO_API_KEY;
};

/**
 * Resolve a pre-configured Composio auth config id for the given toolkit
 * identifier (e.g. 'gmail'). Returns undefined when no pin is configured, in
 * which case the caller falls back to discovering/creating an auth config.
 */
export const getServerComposioAuthConfigId = (identifier: string): string | undefined => {
  if (typeof window !== 'undefined') return undefined;
  const raw = composioEnv.COMPOSIO_AUTH_CONFIG_IDS;
  if (!raw) return undefined;
  try {
    const map = JSON.parse(raw) as Record<string, string>;
    return map[identifier];
  } catch {
    console.error('[Composio] COMPOSIO_AUTH_CONFIG_IDS is not valid JSON');
    return undefined;
  }
};

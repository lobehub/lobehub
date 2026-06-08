import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

/**
 * Klavis Service Configuration
 *
 * Architecture:
 * - Server-side: KLAVIS_API_KEY is stored and used only on the server
 * - Client-side: Klavis enabled status is provided via serverConfig store (enableKlavis)
 * - Client calls server APIs which use the API key
 *
 * Security:
 * - API key is NEVER exposed to the client
 * - Client gets enabled status from server config
 */
export const getKlavisConfig = () => {
  return createEnv({
    client: {},
    runtimeEnv: {
      // Server-side API key (never exposed to client)
      KLAVIS_API_KEY: process.env.KLAVIS_API_KEY,
    },
    server: {
      KLAVIS_API_KEY: z.string().optional(),
    },
  });
};

export const klavisEnv = getKlavisConfig();

/**
 * Get Klavis API Key (server-side only)
 * IMPORTANT: This should only be called from server-side code
 */
export const getServerKlavisApiKey = (): string | undefined => {
  if (typeof window !== 'undefined') {
    console.error('[Klavis] Attempted to access API key from client-side!');
    return undefined;
  }
  return klavisEnv.KLAVIS_API_KEY;
};

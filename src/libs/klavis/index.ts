import { KlavisClient } from 'klavis';

import { getServerKlavisApiKey } from '@/config/klavis';

/**
 * Global Klavis Client instance cache (server-side only)
 */
let klavisClientInstance: { apiKey: string; client: KlavisClient } | undefined;

/**
 * Get or create Klavis Client instance (server-side only)
 * The instance is cached and reused if the API key hasn't changed
 */
export const getKlavisClient = (): KlavisClient => {
  const apiKey = getServerKlavisApiKey();

  if (!apiKey) {
    throw new Error('Klavis API key is not configured on server');
  }

  if (!klavisClientInstance || klavisClientInstance.apiKey !== apiKey) {
    klavisClientInstance = {
      apiKey,
      client: new KlavisClient({ apiKey }),
    };
  }

  return klavisClientInstance.client;
};

/**
 * Check if Klavis client is available (has API key configured)
 */
export const isKlavisClientAvailable = (): boolean => {
  return !!getServerKlavisApiKey();
};

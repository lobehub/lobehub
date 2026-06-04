import { Composio } from '@composio/core';

import { getServerComposioApiKey } from '@/config/composio';

let composioClientInstance: { apiKey: string; client: Composio } | undefined;

export const getComposioClient = (): Composio => {
  const apiKey = getServerComposioApiKey();

  if (!apiKey) {
    throw new Error('Composio API key is not configured on server');
  }

  if (!composioClientInstance || composioClientInstance.apiKey !== apiKey) {
    composioClientInstance = {
      apiKey,
      client: new Composio({ apiKey }),
    };
  }

  return composioClientInstance.client;
};

export const isComposioClientAvailable = (): boolean => {
  return !!getServerComposioApiKey();
};

import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

export const getComposioConfig = () => {
  return createEnv({
    client: {},
    runtimeEnv: {
      COMPOSIO_API_KEY: process.env.COMPOSIO_API_KEY,
    },
    server: {
      COMPOSIO_API_KEY: z.string().optional(),
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

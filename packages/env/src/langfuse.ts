import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export const getLangfuseConfig = () => {
  return createEnv({
    runtimeEnv: {
      ENABLE_LANGFUSE: process.env.ENABLE_LANGFUSE === '1',
      LANGFUSE_SECRET_KEY: process.env.LANGFUSE_SECRET_KEY || '',
      LANGFUSE_PUBLIC_KEY: process.env.LANGFUSE_PUBLIC_KEY || '',
      LANGFUSE_HOST: process.env.LANGFUSE_HOST || 'https://cloud.langfuse.com',
    },

    server: {
      ENABLE_LANGFUSE: z.boolean(),
      LANGFUSE_SECRET_KEY: z.string().optional(),
      LANGFUSE_PUBLIC_KEY: z.string().optional(),
      LANGFUSE_HOST: z.string().url(),
    },
  });
};

export const langfuseEnv = getLangfuseConfig();

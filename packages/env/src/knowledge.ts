import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export const knowledgeEnv = createEnv({
  runtimeEnv: {
    DEFAULT_FILES_CONFIG: process.env.DEFAULT_FILES_CONFIG,
    FILE_TYPE_CHUNKING_RULES: process.env.FILE_TYPE_CHUNKING_RULES,
    UNSTRUCTURED_API_KEY: process.env.UNSTRUCTURED_API_KEY,
    UNSTRUCTURED_SERVER_URL: process.env.UNSTRUCTURED_SERVER_URL,
  },
  server: {
    DEFAULT_FILES_CONFIG: z.string().optional(),
    FILE_TYPE_CHUNKING_RULES: z.string().optional(),
    UNSTRUCTURED_API_KEY: z.string().optional(),
    UNSTRUCTURED_SERVER_URL: z.string().optional(),
  },
});

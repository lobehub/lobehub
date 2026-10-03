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
      TENCENT_SANDBOX_API_BASE: process.env.TENCENT_SANDBOX_API_BASE,
      TENCENT_SANDBOX_API_TOKEN: process.env.TENCENT_SANDBOX_API_TOKEN,
      TENCENT_SANDBOX_MODE: process.env.TENCENT_SANDBOX_MODE,
      TENCENT_SANDBOX_PROJECT_ID: process.env.TENCENT_SANDBOX_PROJECT_ID,
      TENCENT_SANDBOX_REGION: process.env.TENCENT_SANDBOX_REGION,
      TENCENT_SANDBOX_TIMEOUT_SEC: process.env.TENCENT_SANDBOX_TIMEOUT_SEC,
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
        z.enum(['market', 'onlyboxes', 'tencent']).optional(),
      ),
      TENCENT_SANDBOX_API_BASE: z.preprocess(emptyStringToUndefined, z.string().url().optional()),
      TENCENT_SANDBOX_API_TOKEN: z.preprocess(emptyStringToUndefined, z.string().optional()),
      TENCENT_SANDBOX_MODE: z.preprocess(
        emptyStringToUndefined,
        z.enum(['persistent', 'on-demand']).optional(),
      ),
      TENCENT_SANDBOX_PROJECT_ID: z.preprocess(emptyStringToUndefined, z.string().optional()),
      TENCENT_SANDBOX_REGION: z.preprocess(emptyStringToUndefined, z.string().optional()),
      TENCENT_SANDBOX_TIMEOUT_SEC: z.preprocess(
        emptyStringToUndefined,
        z.coerce.number().int().min(300).max(3600).optional(),
      ),
    },
  });
};

export const sandboxEnv = getSandboxConfig();

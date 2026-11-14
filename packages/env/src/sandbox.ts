import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

const emptyStringToUndefined = (value: unknown) => (value === '' ? undefined : value);

export const getSandboxConfig = () => {
  return createEnv({
    runtimeEnv: {
      BOXD_API_KEY: process.env.BOXD_API_KEY,
      BOXD_BASE_URL: process.env.BOXD_BASE_URL,
      BOXD_LEASE_TTL_SEC: process.env.BOXD_LEASE_TTL_SEC,
      BOXD_REGION: process.env.BOXD_REGION,
      BOXD_SNAPSHOT: process.env.BOXD_SNAPSHOT,
      BOXD_VCPU: process.env.BOXD_VCPU,
      ONLYBOXES_BASE_URL: process.env.ONLYBOXES_BASE_URL,
      ONLYBOXES_JIT_ISSUER: process.env.ONLYBOXES_JIT_ISSUER,
      ONLYBOXES_JIT_SIGNING_KEY: process.env.ONLYBOXES_JIT_SIGNING_KEY,
      ONLYBOXES_JIT_TTL_SEC: process.env.ONLYBOXES_JIT_TTL_SEC,
      ONLYBOXES_LEASE_TTL_SEC: process.env.ONLYBOXES_LEASE_TTL_SEC,
      SANDBOX_PROVIDER: process.env.SANDBOX_PROVIDER,
    },
    server: {
      BOXD_API_KEY: z.preprocess(emptyStringToUndefined, z.string().optional()),
      BOXD_BASE_URL: z.preprocess(emptyStringToUndefined, z.string().url().optional()),
      // The lease is pushed back at most once a minute and an export may run 330 s,
      // so a shorter lease could delete a computer while it is in use.
      BOXD_LEASE_TTL_SEC: z.preprocess(
        emptyStringToUndefined,
        z.coerce
          .number()
          .int()
          .refine(
            (value) => value === 0 || value >= 600,
            'BOXD_LEASE_TTL_SEC must be 0 (keep computers) or at least 600 seconds',
          )
          .optional(),
      ),
      BOXD_REGION: z.preprocess(emptyStringToUndefined, z.string().optional()),
      BOXD_SNAPSHOT: z.preprocess(emptyStringToUndefined, z.string().optional()),
      BOXD_VCPU: z.preprocess(
        emptyStringToUndefined,
        z.coerce
          .number()
          .int()
          .refine((value) => [1, 2, 4, 8].includes(value), 'BOXD_VCPU must be 1, 2, 4 or 8')
          .optional(),
      ),
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
        z.enum(['market', 'onlyboxes', 'boxd']).optional(),
      ),
    },
  });
};

export const sandboxEnv = getSandboxConfig();

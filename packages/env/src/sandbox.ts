import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

const emptyStringToUndefined = (value: unknown) => (value === '' ? undefined : value);

export const getSandboxConfig = () => {
  return createEnv({
    runtimeEnv: {
      HETERO_SANDBOX_RUN_TTL_SEC: process.env.HETERO_SANDBOX_RUN_TTL_SEC,
      ONLYBOXES_BASE_URL: process.env.ONLYBOXES_BASE_URL,
      ONLYBOXES_JIT_ISSUER: process.env.ONLYBOXES_JIT_ISSUER,
      ONLYBOXES_JIT_SIGNING_KEY: process.env.ONLYBOXES_JIT_SIGNING_KEY,
      ONLYBOXES_JIT_TTL_SEC: process.env.ONLYBOXES_JIT_TTL_SEC,
      ONLYBOXES_LEASE_TTL_SEC: process.env.ONLYBOXES_LEASE_TTL_SEC,
      SANDBOX_PROVIDER: process.env.SANDBOX_PROVIDER,
    },
    server: {
      /**
       * How long a sandbox run may last, in seconds: the lifetime of the token
       * the run authenticates with. Defaults to four hours. With Onlyboxes the
       * box's lease (`ONLYBOXES_LEASE_TTL_SEC`) has to be at least this long,
       * or the box is destroyed under the run.
       */
      HETERO_SANDBOX_RUN_TTL_SEC: z.preprocess(
        emptyStringToUndefined,
        z.coerce.number().int().positive().optional(),
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
        z.enum(['market', 'onlyboxes']).optional(),
      ),
    },
  });
};

export const sandboxEnv = getSandboxConfig();

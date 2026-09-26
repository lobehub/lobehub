import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

const emptyStringToUndefined = (value: unknown) => (value === '' ? undefined : value);

export const getSandboxConfig = () => {
  return createEnv({
    runtimeEnv: {
      HETERO_SANDBOX_AGENT_TYPES: process.env.HETERO_SANDBOX_AGENT_TYPES,
      HETERO_SANDBOX_FORWARD_ENV: process.env.HETERO_SANDBOX_FORWARD_ENV,
      ONLYBOXES_BASE_URL: process.env.ONLYBOXES_BASE_URL,
      ONLYBOXES_JIT_ISSUER: process.env.ONLYBOXES_JIT_ISSUER,
      ONLYBOXES_JIT_SIGNING_KEY: process.env.ONLYBOXES_JIT_SIGNING_KEY,
      ONLYBOXES_JIT_TTL_SEC: process.env.ONLYBOXES_JIT_TTL_SEC,
      ONLYBOXES_LEASE_TTL_SEC: process.env.ONLYBOXES_LEASE_TTL_SEC,
      SANDBOX_PROVIDER: process.env.SANDBOX_PROVIDER,
    },
    server: {
      /**
       * Coding-agent CLIs that may run in the cloud sandbox, comma-separated
       * (e.g. `claude-code,codex,opencode`). Names are agent type ids; an
       * unrecognised one simply never matches. Defaults to the types the
       * official runtime image ships — widen it only alongside an image that
       * actually carries the extra binaries.
       */
      HETERO_SANDBOX_AGENT_TYPES: z.preprocess(emptyStringToUndefined, z.string().optional()),
      /**
       * Names of environment variables the server may forward into a sandbox
       * run, comma-separated. An allowlist, not a passthrough: nothing the
       * server holds crosses into the box unless it is asked for by name.
       */
      HETERO_SANDBOX_FORWARD_ENV: z.preprocess(emptyStringToUndefined, z.string().optional()),
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

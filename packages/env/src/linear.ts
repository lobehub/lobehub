import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace NodeJS {
    interface ProcessEnv {
      /** Client id of the LobeHub OAuth application registered on Linear. */
      LINEAR_CLIENT_ID?: string;
      LINEAR_CLIENT_SECRET?: string;
    }
  }
}

export const getLinearConfig = () =>
  createEnv({
    runtimeEnv: {
      ENABLED_LINEAR: !!process.env.LINEAR_CLIENT_ID && !!process.env.LINEAR_CLIENT_SECRET,
      LINEAR_CLIENT_ID: process.env.LINEAR_CLIENT_ID,
      LINEAR_CLIENT_SECRET: process.env.LINEAR_CLIENT_SECRET,
    },
    server: {
      /** True when the OAuth application is configured and Linear can be connected. */
      ENABLED_LINEAR: z.boolean(),
      LINEAR_CLIENT_ID: z.string().optional(),
      LINEAR_CLIENT_SECRET: z.string().optional(),
    },
  });

export const linearEnv = getLinearConfig();

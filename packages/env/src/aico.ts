import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace NodeJS {
    interface ProcessEnv {
      /**
       * When `1`, mock top-up mutations are allowed even when `NODE_ENV=production`.
       * Non-production environments always allow mock top-ups regardless of this flag.
       */
      AICO_ALLOW_MOCK_TOPUP?: string;
      /**
       * When `1`, OpenRouter management calls are mocked in-process (local QA).
       * Ignored in production — see `createOpenRouterManagementClient`.
       */
      AICO_OPENROUTER_MOCK?: string;
      /**
       * Toman per 1 USD — fallback FX rate used when the live-rate lookup fails.
       * Example: 50000 means 50,000 toman = $1.
       */
      AICO_TOMAN_PER_USD?: string;
      /**
       * OpenRouter Management API key (sk-or-…). Creates per-user keys.
       * Never expose to the client.
       */
      OPENROUTER_MANAGEMENT_API_KEY?: string;
    }
  }
}

export const getAicoConfig = () => {
  return createEnv({
    server: {
      AICO_ALLOW_MOCK_TOPUP: z.boolean().optional().default(false),
      AICO_OPENROUTER_MOCK: z.boolean().optional().default(false),
      AICO_TOMAN_PER_USD: z.coerce.number().positive().default(50_000),
      OPENROUTER_MANAGEMENT_API_KEY: z.string().optional(),
    },
    runtimeEnv: {
      AICO_ALLOW_MOCK_TOPUP: process.env.AICO_ALLOW_MOCK_TOPUP === '1',
      AICO_OPENROUTER_MOCK: process.env.AICO_OPENROUTER_MOCK === '1',
      AICO_TOMAN_PER_USD: process.env.AICO_TOMAN_PER_USD,
      OPENROUTER_MANAGEMENT_API_KEY: process.env.OPENROUTER_MANAGEMENT_API_KEY,
    },
  });
};

export const aicoEnv = getAicoConfig();

export const tomanToUsd = (amountToman: number, rate = aicoEnv.AICO_TOMAN_PER_USD): number => {
  if (rate <= 0) throw new Error('Invalid FX rate');
  return Math.round((amountToman / rate) * 1_000_000) / 1_000_000;
};

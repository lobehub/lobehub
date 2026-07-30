import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace NodeJS {
    interface ProcessEnv {
      /**
       * When `1`, OpenRouter management calls are mocked in-process (local QA).
       */
      AICO_OPENROUTER_MOCK?: string;
      /**
       * Toman per 1 USD for mock (and interim) FX conversion at purchase time.
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
      AICO_OPENROUTER_MOCK: z.boolean().optional().default(false),
      AICO_TOMAN_PER_USD: z.coerce.number().positive().default(50_000),
      OPENROUTER_MANAGEMENT_API_KEY: z.string().optional(),
    },
    runtimeEnv: {
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

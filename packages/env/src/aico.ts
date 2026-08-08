import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace NodeJS {
    interface ProcessEnv {
      /**
       * When `1`, Trial may be enabled via platform_trial_config in non-production.
       * Production always rejects Trial activation/execution until atomic quota ships.
       */
      AICO_ALLOW_TRIAL?: string;
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
      AICO_ALLOW_TRIAL: z.boolean().optional().default(false),
      AICO_OPENROUTER_MOCK: z.boolean().optional().default(false),
      AICO_TOMAN_PER_USD: z.coerce.number().positive().int().default(50_000),
      OPENROUTER_MANAGEMENT_API_KEY: z.string().optional(),
    },
    runtimeEnv: {
      AICO_ALLOW_TRIAL: process.env.AICO_ALLOW_TRIAL === '1',
      AICO_OPENROUTER_MOCK: process.env.AICO_OPENROUTER_MOCK === '1',
      AICO_TOMAN_PER_USD: process.env.AICO_TOMAN_PER_USD,
      OPENROUTER_MANAGEMENT_API_KEY: process.env.OPENROUTER_MANAGEMENT_API_KEY,
    },
  });
};

export const aicoEnv = getAicoConfig();

/** @deprecated Prefer `tomanToMicroUsd` from `@/database/utils/aicoMoney`. Kept for transitional call sites. */
export const tomanToUsd = (amountToman: number, rate = aicoEnv.AICO_TOMAN_PER_USD): number => {
  if (!Number.isFinite(amountToman) || amountToman <= 0) throw new Error('Invalid FX amount');
  if (!Number.isFinite(rate) || rate <= 0 || !Number.isInteger(rate))
    throw new Error('Invalid FX rate');
  // Integer floor via micro-USD then back to 6-decimal number for legacy callers.
  const micro = (BigInt(Math.trunc(amountToman)) * 1_000_000n) / BigInt(rate);
  return Number(micro) / 1_000_000;
};

import { ON_DEMAND_DEFAULT_BUDGET } from '@lobechat/types';
import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

const optionalNonNegativeInteger = z.preprocess(
  (value) => (value === '' || value === null ? undefined : value),
  z.coerce.number().int().nonnegative().optional(),
);

export const getOnDemandContextConfig = () => {
  return createEnv({
    runtimeEnv: {
      ON_DEMAND_CONTEXT_DYNAMIC_TOKENS: process.env.ON_DEMAND_CONTEXT_DYNAMIC_TOKENS,
      ON_DEMAND_CONTEXT_RESERVE_TOKENS: process.env.ON_DEMAND_CONTEXT_RESERVE_TOKENS,
      ON_DEMAND_CONTEXT_TOTAL_TOKENS: process.env.ON_DEMAND_CONTEXT_TOTAL_TOKENS,
    },
    server: {
      ON_DEMAND_CONTEXT_DYNAMIC_TOKENS: optionalNonNegativeInteger,
      ON_DEMAND_CONTEXT_RESERVE_TOKENS: optionalNonNegativeInteger,
      ON_DEMAND_CONTEXT_TOTAL_TOKENS: optionalNonNegativeInteger,
    },
  });
};

/**
 * Server-side default. The on-demand budget still lives in one config object;
 * the env layer only supplies deployment overrides.
 */
export const onDemandContextEnv = getOnDemandContextConfig();

export const resolveOnDemandContextBudgetDefaults = () => {
  const dynamicTokens =
    onDemandContextEnv.ON_DEMAND_CONTEXT_DYNAMIC_TOKENS ?? ON_DEMAND_DEFAULT_BUDGET.dynamicTokens;
  const reserveTokens =
    onDemandContextEnv.ON_DEMAND_CONTEXT_RESERVE_TOKENS ?? ON_DEMAND_DEFAULT_BUDGET.reserveTokens;
  const totalTokens =
    onDemandContextEnv.ON_DEMAND_CONTEXT_TOTAL_TOKENS ?? ON_DEMAND_DEFAULT_BUDGET.totalTokens;

  if (dynamicTokens + reserveTokens > totalTokens) {
    throw new Error(
      'ON_DEMAND_CONTEXT_DYNAMIC_TOKENS + ON_DEMAND_CONTEXT_RESERVE_TOKENS must not exceed ON_DEMAND_CONTEXT_TOTAL_TOKENS.',
    );
  }

  return { dynamicTokens, reserveTokens, totalTokens };
};

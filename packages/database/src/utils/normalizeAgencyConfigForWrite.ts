import type { LobeAgentAgencyConfig } from '@lobechat/types';
import { isRecord } from '@lobechat/utils/object';

import { sanitizeAgentApiConfig } from './sanitizeAgentApiConfig';

/**
 * Agent config patches are deep-merged, and a merge stores a `null` patch value
 * as `null` rather than removing the key. In `heterogeneousProvider.env` (the
 * CLI spawn env) a `null` can only mean "unset", so drop those entries: `null`
 * deletes an env key, and no reader has to cope with one (the device quota RPC
 * rejected the whole request over `CLAUDE_CONFIG_DIR: null`).
 */
const dropNullHeterogeneousEnv = (
  agencyConfig: LobeAgentAgencyConfig | null | undefined,
): LobeAgentAgencyConfig | null | undefined => {
  const heterogeneousProvider = agencyConfig?.heterogeneousProvider;
  const env: unknown = heterogeneousProvider?.env;
  if (!heterogeneousProvider || !isRecord(env)) return agencyConfig;

  const entries = Object.entries(env);
  const kept = entries.filter(([, value]) => value !== null && value !== undefined);
  if (kept.length === entries.length) return agencyConfig;

  return {
    ...agencyConfig,
    heterogeneousProvider: {
      ...heterogeneousProvider,
      env: Object.fromEntries(kept) as Record<string, string>,
    },
  };
};

/** Write-chokepoint normalization for a persisted Agent `agencyConfig`. */
export const normalizeAgencyConfigForWrite = (
  agencyConfig: LobeAgentAgencyConfig | null | undefined,
): LobeAgentAgencyConfig | null | undefined =>
  sanitizeAgentApiConfig(dropNullHeterogeneousEnv(agencyConfig));

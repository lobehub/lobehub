import type { HeterogeneousApiConfig, LobeAgentAgencyConfig } from '@lobechat/types';
import { isRecord } from '@lobechat/utils/object';

/** Keep provider credentials and arbitrary client fields out of persisted Agent API bindings. */
export const sanitizeAgentApiConfig = (
  agencyConfig: LobeAgentAgencyConfig | null | undefined,
): LobeAgentAgencyConfig | null | undefined => {
  const heterogeneousProvider = agencyConfig?.heterogeneousProvider;
  if (!heterogeneousProvider || !Object.hasOwn(heterogeneousProvider, 'apiConfig')) {
    return agencyConfig;
  }

  const rawApiConfig = heterogeneousProvider.apiConfig;
  let apiConfig: HeterogeneousApiConfig | undefined;
  if (isRecord(rawApiConfig) && typeof rawApiConfig.model === 'string') {
    if (rawApiConfig.source === 'server-default') {
      apiConfig = { model: rawApiConfig.model, source: 'server-default' };
    } else if (typeof rawApiConfig.providerId === 'string') {
      apiConfig = {
        model: rawApiConfig.model,
        providerId: rawApiConfig.providerId,
        ...(typeof rawApiConfig.smallFastModel === 'string' || rawApiConfig.smallFastModel === null
          ? { smallFastModel: rawApiConfig.smallFastModel }
          : {}),
      };
    }
  }

  return {
    ...agencyConfig,
    heterogeneousProvider: {
      ...heterogeneousProvider,
      apiConfig,
    },
  };
};

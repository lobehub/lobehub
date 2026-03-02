import { CAMBAI_API_KEY_HEADER_KEY } from '@/const/fetch';
import { aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';

export const createHeaderWithCambAI = (header?: HeadersInit): HeadersInit => {
  const keyVaults: Record<string, any> =
    aiProviderSelectors.providerKeyVaults('cambai')(useAiInfraStore.getState()) || {};

  return {
    ...header,
    [CAMBAI_API_KEY_HEADER_KEY]: keyVaults.apiKey || process.env.NEXT_PUBLIC_CAMBAI_API_KEY || '',
  };
};

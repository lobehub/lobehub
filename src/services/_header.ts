import { LOBE_USER_ID, OPENAI_API_KEY_HEADER_KEY, OPENAI_END_POINT } from '@/const/fetch';
import { aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';
import { useUserStore } from '@/store/user';

/**
 * TODO: Need to be removed after tts refactor
 * @deprecated
 */
 
export const createHeaderWithOpenAI = (header?: HeadersInit): HeadersInit => {
  const state = useUserStore.getState();

  const keyVaults: Record<string, any> =
    aiProviderSelectors.providerKeyVaults('openai')(useAiInfraStore.getState()) || {};

   
  return {
    ...header,
    [LOBE_USER_ID]: state.user?.id || '',
    [OPENAI_API_KEY_HEADER_KEY]: keyVaults.apiKey || '',
    [OPENAI_END_POINT]: keyVaults.baseURL || '',
  };
};

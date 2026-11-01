import { isProviderFetchOnClient as isSharedProviderFetchOnClient } from 'model-bank/modelProviders';

import { type AIProviderStoreState } from '@/store/aiInfra/initialState';
import { type AiProviderRuntimeConfig } from '@/types/aiProvider';
import { AiProviderSourceEnum } from '@/types/aiProvider';
import { type GlobalLLMProviderKey } from '@/types/user/settings';

// List
const enabledAiProviderList = (s: AIProviderStoreState) =>
  s.aiProviderList.filter((item) => item.enabled).sort((a, b) => a.sort! - b.sort!);

const disabledAiProviderList = (s: AIProviderStoreState) =>
  s.aiProviderList.filter((item) => !item.enabled && item.source !== AiProviderSourceEnum.Custom);

const disabledCustomAiProviderList = (s: AIProviderStoreState) =>
  s.aiProviderList.filter((item) => !item.enabled && item.source === AiProviderSourceEnum.Custom);

const enabledEmbeddingModelList = (s: AIProviderStoreState) => s.enabledEmbeddingModelList || [];
const enabledAsrModelList = (s: AIProviderStoreState) => s.enabledAsrModelList || [];

const enabledImageModelList = (s: AIProviderStoreState) => s.enabledImageModelList || [];

const enabledVideoModelList = (s: AIProviderStoreState) => s.enabledVideoModelList || [];

const hiddenBuiltinModels = (s: AIProviderStoreState) => s.hiddenBuiltinModels;

const isProviderEnabled = (id: string) => (s: AIProviderStoreState) =>
  enabledAiProviderList(s).some((i) => i.id === id);

const isProviderLoading = (id: string) => (s: AIProviderStoreState) =>
  s.aiProviderLoadingIds.includes(id);

// Detail

/**
 * Get provider detail by id from the cache map
 */
const providerDetailById = (id: string) => (s: AIProviderStoreState) => s.aiProviderDetailMap[id];

/**
 * Get active provider config from the cache map
 */
const activeProviderConfig = (s: AIProviderStoreState) =>
  s.activeAiProvider ? s.aiProviderDetailMap[s.activeAiProvider] : undefined;

/**
 * Check if provider config is loading (data not yet in cache)
 */
const isAiProviderConfigLoading = (id: string) => (s: AIProviderStoreState) =>
  !s.aiProviderDetailMap[id];

const activeProviderKeyVaults = (s: AIProviderStoreState) => activeProviderConfig(s)?.keyVaults;

const isActiveProviderEndpointNotEmpty = (s: AIProviderStoreState) => {
  const vault = activeProviderKeyVaults(s);
  return !!vault?.baseURL || !!vault?.endpoint;
};

const isActiveProviderApiKeyNotEmpty = (s: AIProviderStoreState) => {
  const vault = activeProviderKeyVaults(s);
  return !!vault?.apiKey || !!vault?.accessKeyId || !!vault?.secretAccessKey;
};

const providerConfigById =
  (id: string) =>
  (s: AIProviderStoreState): AiProviderRuntimeConfig | undefined => {
    if (!id) return undefined;

    return s.aiProviderRuntimeConfig?.[id];
  };

const isProviderConfigUpdating = (id: string) => (s: AIProviderStoreState) =>
  s.aiProviderConfigUpdatingIds.includes(id);

/**
 * Whether requests to this provider leave from this device. The rule is shared
 * with the server (`isProviderFetchOnClient` in model-bank), which relays a
 * call back to this tab exactly when it applies.
 */
const isProviderFetchOnClient =
  (provider: GlobalLLMProviderKey | string) => (s: AIProviderStoreState) =>
    isSharedProviderFetchOnClient(provider, providerConfigById(provider)(s));

const providerKeyVaults = (provider: string | undefined) => (s: AIProviderStoreState) => {
  if (!provider) return undefined;

  return s.aiProviderRuntimeConfig?.[provider]?.keyVaults;
};

const isProviderHasBuiltinSearch = (provider: string) => (s: AIProviderStoreState) => {
  const config = providerConfigById(provider)(s);

  return !!config?.settings.searchMode;
};

const isProviderHasBuiltinSearchConfig = (id: string) => (s: AIProviderStoreState) => {
  const providerCfg = providerConfigById(id)(s);

  return !!providerCfg?.settings.searchMode && providerCfg?.settings.searchMode !== 'internal';
};

const isProviderEnableResponseApi = (id: string) => (s: AIProviderStoreState) => {
  const providerCfg = providerConfigById(id)(s);

  const enableResponseApi = providerCfg?.config?.enableResponseApi;

  if (typeof enableResponseApi === 'boolean') return enableResponseApi;

  return id === 'openai';
};

const isInitAiProviderRuntimeState = (s: AIProviderStoreState) => !!s.isInitAiProviderRuntimeState;

export const aiProviderSelectors = {
  activeProviderConfig,
  disabledAiProviderList,
  disabledCustomAiProviderList,
  enabledAiProviderList,
  enabledAsrModelList,
  enabledEmbeddingModelList,
  enabledImageModelList,
  enabledVideoModelList,
  hiddenBuiltinModels,
  isActiveProviderApiKeyNotEmpty,
  isActiveProviderEndpointNotEmpty,
  isAiProviderConfigLoading,
  isInitAiProviderRuntimeState,
  isProviderConfigUpdating,
  isProviderEnableResponseApi,
  isProviderEnabled,
  isProviderFetchOnClient,
  isProviderHasBuiltinSearch,
  isProviderHasBuiltinSearchConfig,
  isProviderLoading,
  providerConfigById,
  providerDetailById,
  providerKeyVaults,
};

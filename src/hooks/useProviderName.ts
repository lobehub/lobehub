import { BRANDING_NAME } from '@lobechat/business-const';
import { DEFAULT_MODEL_PROVIDER_LIST } from 'model-bank/modelProviders';

import { isBrandedOpenRouterProvider } from '@/components/Branding/brandedModelId';

export const useProviderName = (provider: string) => {
  if (isBrandedOpenRouterProvider(provider)) return BRANDING_NAME;

  const providerCard = DEFAULT_MODEL_PROVIDER_LIST.find((p) => p.id === provider);

  return providerCard?.name || provider;
};

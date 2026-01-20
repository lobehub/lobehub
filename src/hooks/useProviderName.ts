import { DEFAULT_MODEL_PROVIDER_LIST } from 'model-bank/modelProviders';

export const useProviderName = (provider: string) => {
  const providerCard = DEFAULT_MODEL_PROVIDER_LIST.find((p) => p.id === provider);

  return providerCard?.name || provider;
};

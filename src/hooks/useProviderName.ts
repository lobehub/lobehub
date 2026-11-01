import { getProviderDisplayName } from 'model-bank/modelProviders';

export const useProviderName = (provider: string) => getProviderDisplayName(provider);

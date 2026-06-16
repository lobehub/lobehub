import { swrCacheProvider } from './localStorageProvider';
import { getCacheScope } from './useCacheScope';

export const appSWRCacheProvider = swrCacheProvider(getCacheScope);

export const hydrateAppSWRCache = async (): Promise<void> => {
  await appSWRCacheProvider.hydrateScope?.();
};

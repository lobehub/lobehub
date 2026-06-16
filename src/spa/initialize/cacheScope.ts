import { appSWRCacheProvider } from '@/libs/swr/appCacheProvider';
import { getCacheScope } from '@/libs/swr/useCacheScope';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

let lastScope: string | undefined;
let unsubscribeUserScope: (() => void) | undefined;

const syncSWRCacheScope = () => {
  const scope = getCacheScope();
  if (lastScope === scope) return;

  lastScope = scope;
  void appSWRCacheProvider.reloadScope?.();
};

export const startSWRCacheScopeSync = () => {
  if (unsubscribeUserScope) return;

  lastScope = getCacheScope();
  unsubscribeUserScope = useUserStore.subscribe(userProfileSelectors.userId, syncSWRCacheScope);
};

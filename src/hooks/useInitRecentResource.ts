import { useHomeStore } from '@/store/home';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

/**
 * Hook to initialize and fetch recent resources (files)
 * Only fetches when user is logged in
 *
 * Usage:
 * const { isLoading } = useInitRecentResource();
 *
 * Then access data directly from store:
 * const recentResources = useHomeStore(homeRecentSelectors.recentResources);
 * const isInit = useHomeStore(homeRecentSelectors.isRecentResourcesInit);
 */
export const useInitRecentResource = () => {
  const useFetchRecentResources = useHomeStore((s) => s.useFetchRecentResources);

  const isLogin = useUserStore(authSelectors.isLogin);

  const { isValidating, data, ...rest } = useFetchRecentResources(isLogin);

  return {
    ...rest,
    data,
    isLoading: rest.isLoading && isLogin,
    // isRevalidating: 有缓存数据，后台正在更新
    isRevalidating: isValidating && !!data,
  };
};

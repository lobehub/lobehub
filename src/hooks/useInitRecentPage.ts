import { useHomeStore } from '@/store/home';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

/**
 * Hook to initialize and fetch recent pages (documents)
 * Only fetches when user is logged in
 *
 * Usage:
 * const { isLoading } = useInitRecentPage();
 *
 * Then access data directly from store:
 * const recentPages = useHomeStore(homeRecentSelectors.recentPages);
 * const isInit = useHomeStore(homeRecentSelectors.isRecentPagesInit);
 */
export const useInitRecentPage = () => {
  const useFetchRecentPages = useHomeStore((s) => s.useFetchRecentPages);

  const isLogin = useUserStore(authSelectors.isLogin);

  const { isValidating, data, ...rest } = useFetchRecentPages(isLogin);

  return {
    ...rest,
    data,
    isLoading: rest.isLoading && isLogin,
    // isRevalidating: has cached data, updating in background
    isRevalidating: isValidating && !!data,
  };
};

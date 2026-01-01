import { useHomeStore } from '@/store/home';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

/**
 * Hook to initialize and fetch recent topics
 * Only fetches when user is logged in
 *
 * Usage:
 * const { isLoading } = useInitRecentTopic();
 *
 * Then access data directly from store:
 * const recentTopics = useHomeStore(homeRecentSelectors.recentTopics);
 * const isInit = useHomeStore(homeRecentSelectors.isRecentTopicsInit);
 */
export const useInitRecentTopic = () => {
  const useFetchRecentTopics = useHomeStore((s) => s.useFetchRecentTopics);

  const isLogin = useUserStore(authSelectors.isLogin);

  const { isValidating, data, ...rest } = useFetchRecentTopics(isLogin);

  return {
    ...rest,
    data,
    isLoading: rest.isLoading && isLogin,
    // isRevalidating: 有缓存数据，后台正在更新
    isRevalidating: isValidating && !!data,
  };
};

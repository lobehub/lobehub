import { useCacheScope } from '@/libs/swr/useCacheScope';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useHomeStore } from '@/store/home';
import { createRecentQueryKey } from '@/store/home/slices/recent/initialState';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

export const useInitRecents = () => {
  const useFetchRecents = useHomeStore((s) => s.useFetchRecents);
  const isLogin = useUserStore(authSelectors.isLogin);
  const scope = useCacheScope();
  const recentPageSize = useGlobalStore(systemStatusSelectors.recentPageSize);

  const query = useHomeStore(
    (s) => s.recentsByScope[scope]?.queries[createRecentQueryKey(recentPageSize + 1)],
  );
  const { isValidating, ...rest } = useFetchRecents(isLogin, scope, recentPageSize);

  return {
    ...rest,
    data: query?.items,
    isLoading: !query && rest.isLoading && isLogin,
    isRevalidating: isValidating && !!query,
  };
};

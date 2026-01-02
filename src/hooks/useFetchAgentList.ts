import { useHomeStore } from '@/store/home';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

/**
 * Hook to fetch agent list
 * @returns isValidating - true when background revalidation is in progress (has cached data but fetching new)
 */
export const useFetchAgentList = () => {
  const isLogin = useUserStore(authSelectors.isLogin);
  const useFetchAgentListHook = useHomeStore((s) => s.useFetchAgentList);

  const { isValidating, data } = useFetchAgentListHook(isLogin);

  // isRevalidating: 有缓存数据，后台正在更新
  return {
    isRevalidating: isValidating && !!data,
  };
};

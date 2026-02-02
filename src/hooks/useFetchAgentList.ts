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

  // isRevalidating: has cached data, updating in background
  return {
    isRevalidating: isValidating && !!data,
  };
};

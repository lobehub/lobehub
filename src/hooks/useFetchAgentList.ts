import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

/**
 * Sync the sidebar agent list (the rows come from `homeAgentListSelectors`).
 * @returns isRevalidating - true when background revalidation is in progress (has cached data but fetching new)
 * @returns error - the network error, so consumers can surface a failure state instead of a permanent skeleton
 * @returns mutate - retry the same request (wired into the error state's Retry)
 */
export const useFetchAgentList = () => {
  const isLogin = useUserStore(authSelectors.isLogin);
  const useFetchAgentListHook = useHomeStore((s) => s.useFetchAgentList);

  const isAgentListInit = useHomeStore(homeAgentListSelectors.isAgentListInit);

  const { error, isValidating, revalidate } = useFetchAgentListHook(isLogin);

  return {
    error,
    // isRevalidating: has cached data, updating in background
    isRevalidating: isValidating && isAgentListInit,
    mutate: revalidate,
  };
};

'use client';

import { useHomeSidebarRequest } from '@/projection';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

/**
 * Hook to fetch agent list
 * @returns isRevalidating - true when background revalidation is in progress (has cached data but fetching new)
 * @returns error - the thrown SWR error, so consumers can surface a failure state instead of a permanent skeleton
 * @returns mutate - retry the same request (wired into the error state's Retry)
 */
export const useFetchAgentList = () => {
  const isLogin = useUserStore(authSelectors.isLogin);
  const { isInitialized, isValidating, error, mutate } = useHomeSidebarRequest(isLogin);

  return {
    error,
    isInitialized,
    // isRevalidating: a complete EntityView exists while SWR schedules a refresh
    isRevalidating: isValidating && isInitialized,
    mutate,
  };
};

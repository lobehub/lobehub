'use client';

import isEqual from 'fast-deep-equal';
import { useLayoutEffect } from 'react';

import { useClientDataStore, useHomeSidebarRequest } from '@/client-data';
import { selectHomeSidebar } from '@/client-data/modules/home/selectors';
import { useHomeStore } from '@/store/home';
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
  const { isInitialized, isValidating, error, mutate, scope } = useHomeSidebarRequest(isLogin);
  const syncLegacyProjection = useHomeStore((state) => state.internal_syncAgentListProjection);

  // Existing non-Home consumers still select the old HomeStore list. Drive
  // that projection through an imperative subscription so callers of this
  // request hook never become React subscribers to the aggregate EntityView.
  useLayoutEffect(
    () =>
      useClientDataStore.subscribe(
        (state) => selectHomeSidebar(state.scopes[scope]),
        (data) => syncLegacyProjection(data, scope),
        { equalityFn: isEqual, fireImmediately: true },
      ),
    [scope, syncLegacyProjection],
  );

  return {
    error,
    isInitialized,
    // isRevalidating: a complete EntityView exists while SWR schedules a refresh
    isRevalidating: isValidating && isInitialized,
    mutate,
  };
};

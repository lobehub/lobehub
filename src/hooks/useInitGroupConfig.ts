import { useAgentGroupStore } from '@/store/agentGroup';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

export const useInitGroupConfig = () => {
  const [useFetchGroupDetail, activeGroupId] = useAgentGroupStore((s) => [
    s.useFetchGroupDetail,
    s.activeGroupId,
  ]);

  const isLogin = useUserStore(authSelectors.isLogin);

  // Only fetch group detail if we have a valid group ID and user is logged in
  const shouldFetch = Boolean(isLogin && activeGroupId);
  const { isValidating, data, ...rest } = useFetchGroupDetail(shouldFetch, activeGroupId || '');

  return {
    ...rest,
    data,
    error: rest.error || (!shouldFetch ? undefined : rest.error),
    isLoading: (rest.isLoading && isLogin) || !shouldFetch,
    // isRevalidating: has cached data, updating in background
    isRevalidating: isValidating && !!data,
  };
};

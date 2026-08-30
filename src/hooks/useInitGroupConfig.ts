import { useChatGroupProjectionState } from '@/projection';
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
  const { isValidating, ...rest } = useFetchGroupDetail(shouldFetch, activeGroupId || '');
  const projection = useChatGroupProjectionState(shouldFetch ? activeGroupId : undefined);
  const data = projection.hasRecord ? (projection.data ?? null) : undefined;

  return {
    ...rest,
    data,
    error: rest.error || (!shouldFetch ? undefined : rest.error),
    isLoading: (rest.isLoading && isLogin) || !shouldFetch,
    // isRevalidating: has cached data, updating in background
    isRevalidating: isValidating && projection.hasRecord,
  };
};

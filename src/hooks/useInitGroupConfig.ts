import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

export const useInitGroupConfig = () => {
  const [useFetchGroupDetail, activeGroupId, group] = useAgentGroupStore((s) => [
    s.useFetchGroupDetail,
    s.activeGroupId,
    s.activeGroupId ? agentGroupSelectors.getGroupById(s.activeGroupId)(s) : undefined,
  ]);

  const isLogin = useUserStore(authSelectors.isLogin);

  // Only fetch group detail if we have a valid group ID and user is logged in
  const shouldFetch = Boolean(isLogin && activeGroupId);
  // Fetch orchestration only — the group itself is read from `groupMap`.
  const { error, isHydrated, isValidating } = useFetchGroupDetail(shouldFetch, activeGroupId || '');

  return {
    data: group,
    error: shouldFetch ? error : undefined,
    // Nothing painted yet (neither the persisted row nor the network): the
    // surface still has to render its skeleton.
    isLoading: shouldFetch ? !group && !isHydrated : true,
    // isRevalidating: has cached data, updating in background
    isRevalidating: isValidating && !!group,
  };
};

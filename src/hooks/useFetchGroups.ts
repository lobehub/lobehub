import { useAgentGroupStore } from '@/store/agentGroup';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

export const useFetchGroups = () => {
  const isLogin = useUserStore(authSelectors.isLogin);
  const useFetchGroups = useAgentGroupStore((s) => s.useFetchGroups);

  useFetchGroups(true, isLogin ?? false);
};

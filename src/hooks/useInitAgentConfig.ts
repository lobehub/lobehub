import { useParams } from 'react-router-dom';

import { useAgentStore } from '@/store/agent';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

/**
 * If a targetAgentId is provided, use it to fetch the agent config directly.
 * Otherwise, use the active session id to fetch the config.
 */
export const useInitAgentConfig = (agentId?: string) => {
  const [useFetchAgentConfig, activeAgentId] = useAgentStore((s) => [
    s.useFetchAgentConfig,
    s.activeAgentId,
  ]);

  const isLogin = useUserStore(authSelectors.isLogin);

  const params = useParams<{ aid?: string }>();

  // Prioritize URL params over store's activeAgentId to avoid stale ID from previous navigation
  const id = agentId || params.aid || activeAgentId || '';

  const data = useFetchAgentConfig(isLogin, id);

  return { ...data, isLoading: data.isLoading && isLogin };
};

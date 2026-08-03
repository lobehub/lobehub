import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useHomeStore } from '@/store/home';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

/**
 * Hook to fetch the agent label registry into the home store. Mounted by
 * every surface that renders labels (sidebar list, view-all page, settings) —
 * SWR dedupes concurrent mounts.
 *
 * Scoped by workspace: the registries are disjoint, so a switch must refetch
 * rather than reuse the previous scope's cache.
 */
export const useFetchAgentLabels = () => {
  const isLogin = useUserStore(authSelectors.isLogin);
  const workspaceId = useActiveWorkspaceId();
  const useFetchAgentLabelsHook = useHomeStore((s) => s.useFetchAgentLabels);

  return useFetchAgentLabelsHook(isLogin, workspaceId);
};

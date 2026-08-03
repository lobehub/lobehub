import { useHomeStore } from '@/store/home';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

/**
 * Hook to fetch the agent label registry into the home store. Mounted by
 * every surface that renders labels (sidebar list, view-all page, settings) —
 * SWR dedupes concurrent mounts.
 */
export const useFetchAgentLabels = () => {
  const isLogin = useUserStore(authSelectors.isLogin);
  const useFetchAgentLabelsHook = useHomeStore((s) => s.useFetchAgentLabels);

  return useFetchAgentLabelsHook(isLogin);
};

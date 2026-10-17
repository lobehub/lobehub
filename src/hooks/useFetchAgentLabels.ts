import { useHomeStore } from '@/store/home';
import { agentLabelSelectors } from '@/store/home/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

/**
 * Sync the agent label registry into the home store (the labels are read
 * through `agentLabelSelectors`). Mounted by every surface that renders labels
 * (sidebar list, view-all page, settings) — the replica's sync hook dedupes
 * concurrent mounts.
 *
 * The scope (personal / workspace) is owned by the replica, so the caller no
 * longer passes a workspace id: a switch drops the previous registry and
 * refetches on its own.
 *
 * @returns isLoading - registry not loaded yet and a fetch is in flight (drives
 *   the settings page skeleton instead of an empty "no labels" state)
 * @returns error - the network error, so consumers can surface a failure state
 *   instead of a permanent skeleton
 * @returns mutate - retry the same request (wired into the error state's Retry)
 */
export const useFetchAgentLabels = () => {
  const isLogin = useUserStore(authSelectors.isLogin);
  const useFetchAgentLabelsHook = useHomeStore((s) => s.useFetchAgentLabels);

  const isAgentLabelsInit = useHomeStore(agentLabelSelectors.isLabelsInit);

  const { error, isValidating, revalidate } = useFetchAgentLabelsHook(isLogin);

  return {
    error,
    isLoading: !isAgentLabelsInit && isValidating,
    mutate: revalidate,
  };
};

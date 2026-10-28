import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useUserStore } from '@/store/user';
import { workspaceUserSettingsSelectors } from '@/store/user/selectors';

/**
 * Whether topic lists and searches show only the caller's own topics — the
 * member's "only mine" choice for the active workspace. Always false in
 * personal mode.
 */
export const useTopicOnlyMine = (): boolean => {
  const activeWorkspaceId = useActiveWorkspaceId();
  return useUserStore(workspaceUserSettingsSelectors.topicOnlyMine(activeWorkspaceId));
};

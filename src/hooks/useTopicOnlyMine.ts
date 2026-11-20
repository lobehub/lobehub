import { useCallback } from 'react';

import { useHasActiveWorkspace } from '@/business/client/hooks/useHasActiveWorkspace';
import { useTopicListScope } from '@/features/AgentSidebar/Topic/TopicListScope';
import { useChatStore } from '@/store/chat';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

/**
 * Owner of the topic list on screen, which the "only mine" choice is keyed by:
 * the project of a project sidebar, else the active group, else the active
 * agent.
 */
export const useTopicOnlyMineOwnerId = (): string | undefined => {
  const scope = useTopicListScope();
  const [activeAgentId, activeGroupId] = useChatStore((s) => [s.activeAgentId, s.activeGroupId]);
  return scope?.projectId || activeGroupId || activeAgentId || undefined;
};

/**
 * Whether topic lists and searches show only the caller's own topics — a
 * device-local choice each agent (group / project) keeps for itself. Always
 * false in personal mode. Pass `ownerId` when the list names its agent
 * explicitly instead of following the active session.
 */
export const useTopicOnlyMine = (ownerId?: string): boolean => {
  const hasActiveWorkspace = useHasActiveWorkspace();
  const activeOwnerId = useTopicOnlyMineOwnerId();
  const onlyMine = useGlobalStore(systemStatusSelectors.topicOnlyMine(ownerId ?? activeOwnerId));
  return hasActiveWorkspace && onlyMine;
};

/** Writes the "only mine" choice of one topic-list owner. */
export const useSetTopicOnlyMine = () => {
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);
  return useCallback(
    (ownerId: string, onlyMine: boolean) =>
      updateSystemStatus({ topicOnlyMineByAgent: { [ownerId]: onlyMine } }),
    [updateSystemStatus],
  );
};

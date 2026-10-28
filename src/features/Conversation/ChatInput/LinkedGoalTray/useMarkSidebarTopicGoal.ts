import { useEffect, useRef } from 'react';

import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { useProjectDirectoryStore } from '@/store/projectWorkingDirectory';

/**
 * A goal is usually created mid-conversation (`/goal`, `lh goal create
 * --conversation`), after the sidebar lists already loaded this topic without
 * the goal marker. Once the server confirms the conversation has a goal, mark
 * the agent list row in place and refetch the project list once, so the
 * marker appears without a reload.
 */
export const useMarkSidebarTopicGoal = (topicId: string | null | undefined, hasGoal: boolean) => {
  const topic = useChatStore((s) =>
    topicId ? topicSelectors.getTopicById(topicId)(s) : undefined,
  );
  const agentRowUnmarked = !!topic && !topic.hasGoal;
  const projectId = topic?.projectId ?? undefined;
  const projectRowUnmarked = useProjectDirectoryStore((s) => {
    if (!projectId || !topicId) return false;
    const row = s.projectTopicsMap[projectId]?.find((item) => item.id === topicId);
    return !!row && !row.hasGoal;
  });
  const refreshedRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!hasGoal || !topicId || !agentRowUnmarked) return;
    useChatStore
      .getState()
      .internal_dispatchTopic({ id: topicId, type: 'updateTopic', value: { hasGoal: true } });
  }, [hasGoal, topicId, agentRowUnmarked]);

  useEffect(() => {
    if (!hasGoal || !topicId || !projectId || !projectRowUnmarked) return;
    // Once per topic: the server applies the same goal filter as the tray, so a
    // second refetch would not change the row.
    if (refreshedRef.current === topicId) return;
    refreshedRef.current = topicId;
    void useProjectDirectoryStore.getState().refreshProjectTopics(projectId);
  }, [hasGoal, topicId, projectId, projectRowUnmarked]);
};

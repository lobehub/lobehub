import { useEffect, useRef } from 'react';

import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { useProjectDirectoryStore } from '@/store/projectWorkingDirectory';

/**
 * Keep the sidebar goal marker in step with the conversation's goals. A goal is
 * usually created mid-conversation (`/goal`, `lh goal create --conversation`)
 * after the lists loaded this topic, and deleting the last one empties the tray
 * while the lists still say it has one; neither list polls an idle topic. Once
 * the server confirms whether the conversation has a goal, correct the agent
 * list row in place and refetch the project list once, without a reload.
 *
 * `hasGoal` is `undefined` until the server confirmed the tray's rows: a cached
 * or still-pending result must not flip the marker either way.
 */
export const useMarkSidebarTopicGoal = (
  topicId: string | null | undefined,
  hasGoal: boolean | undefined,
) => {
  const topic = useChatStore((s) =>
    topicId ? topicSelectors.getTopicById(topicId)(s) : undefined,
  );
  const agentRowStale = !!topic && hasGoal !== undefined && !!topic.hasGoal !== hasGoal;
  const projectId = topic?.projectId ?? undefined;
  const projectRowStale = useProjectDirectoryStore((s) => {
    if (!projectId || !topicId || hasGoal === undefined) return false;
    const row = s.projectTopicsMap[projectId]?.find((item) => item.id === topicId);
    return !!row && !!row.hasGoal !== hasGoal;
  });
  const refreshedRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!topicId || hasGoal === undefined || !agentRowStale) return;
    useChatStore
      .getState()
      .internal_dispatchTopic({ id: topicId, type: 'updateTopic', value: { hasGoal } });
  }, [hasGoal, topicId, agentRowStale]);

  useEffect(() => {
    if (!topicId || !projectId || hasGoal === undefined || !projectRowStale) return;
    // Once per topic and direction: the server applies the same goal filter as
    // the tray, so a second refetch for the same answer would not change the row.
    const key = `${topicId}:${hasGoal}`;
    if (refreshedRef.current === key) return;
    refreshedRef.current = key;
    void useProjectDirectoryStore.getState().refreshProjectTopics(projectId);
  }, [hasGoal, topicId, projectId, projectRowStale]);
};

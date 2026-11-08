import type { AgentRunBoardRunningOperation } from '@lobechat/types';
import { useCallback } from 'react';

import { useTaskStore } from '@/store/task';

export interface RunDrawerTarget {
  agentId: string;
  runningOperation: AgentRunBoardRunningOperation | null;
  title: string;
  topicId: string | null;
}

/** Opens a run's conversation in Home's drawer, keeping the board in view behind it. */
export const useOpenRunDrawer = () => {
  const setActiveTaskId = useTaskStore((s) => s.setActiveTaskId);
  const openTopicDrawer = useTaskStore((s) => s.openTopicDrawer);

  return useCallback(
    ({ agentId, runningOperation, title, topicId }: RunDrawerTarget) => {
      if (!topicId) return;
      // Clears any prior drawer state, so it has to run before opening.
      setActiveTaskId(undefined);
      openTopicDrawer(topicId, { agentId, runningOperation: runningOperation ?? undefined, title });
    },
    [openTopicDrawer, setActiveTaskId],
  );
};

import { useCallback } from 'react';

import { useTaskStore } from '@/store/task';

export interface RunDrawerTarget {
  agentId: string;
  title: string;
  topicId: string | null;
}

/** Opens a run's conversation in Home's drawer, keeping the board in view behind it. */
export const useOpenRunDrawer = () => {
  const setActiveTaskId = useTaskStore((s) => s.setActiveTaskId);
  const openTopicDrawer = useTaskStore((s) => s.openTopicDrawer);

  return useCallback(
    ({ agentId, title, topicId }: RunDrawerTarget) => {
      if (!topicId) return;
      // Clears any prior drawer state, so it has to run before opening.
      setActiveTaskId(undefined);
      openTopicDrawer(topicId, { agentId, title });
    },
    [openTopicDrawer, setActiveTaskId],
  );
};

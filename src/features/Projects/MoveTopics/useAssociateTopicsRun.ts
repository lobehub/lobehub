import { useModalContext } from '@lobehub/ui';
import { useState } from 'react';

import { useChatStore } from '@/store/chat';
import {
  type AssociateTopicsProgress,
  type AssociateTopicsResult,
  useProjectDirectoryStore,
} from '@/store/projectWorkingDirectory';

/**
 * Drive one group filing: progress while the batches run, the result after.
 * The modal cannot be dismissed mid-run, so a long run is not lost behind it.
 */
export const useAssociateTopicsRun = () => {
  const associateTopics = useProjectDirectoryStore((s) => s.associateTopics);
  const { setCanDismissByClickOutside } = useModalContext();
  const [progress, setProgress] = useState<AssociateTopicsProgress>();
  const [result, setResult] = useState<AssociateTopicsResult>();

  const run = async (projectId: string, topicIds: string[]) => {
    setResult(undefined);
    setCanDismissByClickOutside?.(false);
    try {
      const next = await associateTopics(projectId, topicIds, setProgress);
      // The agent-side lists group conversations by project too.
      if (next.movedTopicIds.length) await useChatStore.getState().refreshTopic();
      setResult(next);
      return next;
    } finally {
      setProgress(undefined);
      setCanDismissByClickOutside?.(true);
    }
  };

  return { progress, result, run, running: !!progress };
};

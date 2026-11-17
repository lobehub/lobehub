import { useModalContext } from '@lobehub/ui';
import { useRef, useState } from 'react';

import { useChatStore } from '@/store/chat';
import {
  type AssociateTopicsProgress,
  type AssociateTopicsResult,
  useProjectDirectoryStore,
} from '@/store/projectWorkingDirectory';

/** The topics a failed run never reached: neither filed nor skipped with a reason. */
export const remainingTopicIds = (topicIds: string[], result: AssociateTopicsResult) => {
  const settled = new Set([
    ...result.movedTopicIds,
    ...result.skippedTopics.map((topic) => topic.id),
  ]);
  return topicIds.filter((id) => !settled.has(id));
};

/**
 * Drive one group filing: progress while the batches run, the result after.
 * The modal cannot be dismissed mid-run, so a long run is not lost behind it.
 * After a failed batch, `retry` files only the topics the run never reached.
 */
export const useAssociateTopicsRun = () => {
  const associateTopics = useProjectDirectoryStore((s) => s.associateTopics);
  const { setCanDismissByClickOutside } = useModalContext();
  const [progress, setProgress] = useState<AssociateTopicsProgress>();
  const [result, setResult] = useState<AssociateTopicsResult>();
  const lastRun = useRef<{ projectId: string; topicIds: string[] }>(undefined);

  const run = async (projectId: string, topicIds: string[]) => {
    lastRun.current = { projectId, topicIds };
    setResult(undefined);
    setCanDismissByClickOutside?.(false);
    try {
      const next = await associateTopics(projectId, topicIds, setProgress);
      // The agent-side lists group conversations by project too. Best effort:
      // the write already landed, and the result must still be reported.
      if (next.movedTopicIds.length)
        await useChatStore
          .getState()
          .refreshTopic()
          .catch((error) => console.error('[MoveTopics] refresh failed:', error));
      setResult(next);
      return next;
    } finally {
      setProgress(undefined);
      setCanDismissByClickOutside?.(true);
    }
  };

  const retry = async () => {
    if (!lastRun.current || !result) return;
    const { projectId, topicIds } = lastRun.current;
    const previous = result;
    const next = await run(projectId, remainingTopicIds(topicIds, previous));
    // Report the whole group, not only the retried tail.
    const merged: AssociateTopicsResult = {
      ...next,
      movedTopicIds: [...previous.movedTopicIds, ...next.movedTopicIds],
      skippedTopics: [...previous.skippedTopics, ...next.skippedTopics],
    };
    lastRun.current = { projectId, topicIds };
    setResult(merged);
    return merged;
  };

  return { progress, result, retry, run, running: !!progress };
};

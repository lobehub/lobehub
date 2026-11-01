import { useCallback, useState } from 'react';

import { useConversationStore } from '@/features/Conversation/store';

/** Runs before the retry; resolving to `false` skips the retry. */
type BeforeRetry = () => Promise<boolean | void> | boolean | void;

/**
 * @param id - Error message id; its parent user message is the retry target.
 * @param parentIdOverride - Retry target supplied by an assistant group, whose `id` is a nested
 * content block rather than a top-level display message.
 */
export const useRetryParentMessage = (id: string, parentIdOverride?: string) => {
  const [loading, setLoading] = useState(false);

  const regenerateUserMessage = useConversationStore((s) => s.regenerateUserMessage);
  const ownParentId = useConversationStore(
    (s) => s.displayMessages.find((m) => m.id === id)?.parentId,
  );
  const parentId = parentIdOverride ?? ownParentId;

  const retryParentMessage = useCallback(
    async (beforeRetry?: BeforeRetry) => {
      if (!parentId) return;

      setLoading(true);
      try {
        if ((await beforeRetry?.()) === false) return;
        await regenerateUserMessage(parentId);
      } finally {
        setLoading(false);
      }
    },
    [parentId, regenerateUserMessage],
  );

  return {
    disabled: !parentId,
    loading,
    parentId,
    retryParentMessage,
  };
};

import { SUBMIT_ACK_TIMEOUT_MS } from '@lobechat/shared-tool-ui/ask-user';
import { useEffect } from 'react';

import { useConversationStore } from '@/features/Conversation/store';
import { dataSelectors } from '@/features/Conversation/store/slices/data/selectors';
import { useChatStore } from '@/store/chat';

/**
 * Settle a submitted Claude Code card whose producer ACK was missed. Stream
 * events normally settle it; after `SUBMIT_ACK_TIMEOUT_MS`, a remount or a
 * reconnect, re-read the submission instead of leaving the card disabled.
 *
 * Only runs once an answer was submitted (`resolving`): it never puts a clock
 * on the user's own decision.
 *
 * @returns whether the card is waiting for that acknowledgement
 */
export const useSubmissionReconcile = (messageId: string): boolean => {
  const context = useConversationStore((s) => s.context);
  const checkQuestionSubmission = useChatStore((s) => s.checkQuestionSubmission);
  const resolving = useConversationStore(
    (s) => dataSelectors.getDbMessageById(messageId)(s)?.pluginIntervention?.resolving === true,
  );

  useEffect(() => {
    if (!resolving) return;
    const reconcile = () => void checkQuestionSubmission(messageId, context);
    const timer = window.setTimeout(reconcile, SUBMIT_ACK_TIMEOUT_MS);
    window.addEventListener('online', reconcile);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('online', reconcile);
    };
  }, [checkQuestionSubmission, context, messageId, resolving]);

  return resolving;
};

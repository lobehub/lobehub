import { toast } from '@lobehub/ui/base-ui';
import { t } from 'i18next';
import { useCallback } from 'react';

import {
  dataSelectors,
  messageStateSelectors,
  useConversationStore,
} from '@/features/Conversation/store';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

/**
 * Confirms an edit while preserving the source of a Codex branch.
 *
 * Use when:
 * - Submitting a message editor.
 * Expects:
 * - The conversation store owns the selected message.
 * Returns:
 * - A submit handler that preserves the draft on setup failure and closes
 *   after the child is saved, before its native run can request permission.
 */
export const useEditConfirmation = ({
  canCreate,
  canEdit,
  editing,
  id,
  onEditingChange,
}: {
  canCreate: boolean;
  canEdit: boolean;
  editing?: boolean;
  id: string;
  onEditingChange: (editing: boolean) => void;
}) => {
  const [updateMessageContent, regenerateUserMessage, forkCodexMessage] = useConversationStore(
    (state) => [state.updateMessageContent, state.regenerateUserMessage, state.forkCodexMessage],
  );
  const isCodex = useAgentStore(
    (state) => agentSelectors.currentAgentHeterogeneousProviderType(state) === 'codex',
  );
  const isInputLoading = useConversationStore(messageStateSelectors.isInputLoading);
  const shouldSendOnConfirm = useConversationStore((state) => {
    if (!editing || dataSelectors.getDisplayMessageById(id)(state)?.role !== 'user') return false;
    if (!isCodex && state.displayMessages.findLast((message) => message.role === 'user')?.id !== id)
      return false;
    return isCodex || !messageStateSelectors.isInputLoading(state);
  });
  const onConfirm = useCallback(
    async (content: string, editorData?: Record<string, unknown>) => {
      if (isCodex) {
        try {
          if (!canEdit || !canCreate || !shouldSendOnConfirm || isInputLoading) {
            throw new Error(t('codexEditUnavailable', { ns: 'common' }));
          }
          await forkCodexMessage(id, { content, editorData }, () => onEditingChange(false));
        } catch (error) {
          console.error('[Conversation] Failed to resend edited Codex message:', error);
          toast.error(
            t('codexForkFailed', {
              ns: 'common',
              message: error instanceof Error ? error.message : String(error),
            }),
          );
          throw error;
        }
        return;
      }
      if (!canEdit) return;
      onEditingChange(false);
      const save = updateMessageContent(id, content, { editorData });
      if (canCreate && shouldSendOnConfirm) await regenerateUserMessage(id);
      await save;
    },
    [
      canCreate,
      canEdit,
      forkCodexMessage,
      id,
      isCodex,
      isInputLoading,
      onEditingChange,
      regenerateUserMessage,
      shouldSendOnConfirm,
      updateMessageContent,
    ],
  );
  return { onConfirm, shouldSendOnConfirm };
};

import type { ConversationContext } from '@lobechat/types';

import type { ChatInputEditor } from '@/features/ChatInput';
import type { ChatStore } from '@/store/chat/store';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { restoreSendEditorState } from './sendEditorState';

export const recoverFailedSend = ({
  context,
  editor,
  error,
  get,
  isEditorCurrent,
  message,
  onPreflightFailure,
  operationId,
  snapshot,
}: {
  context: ConversationContext;
  editor?: ChatInputEditor | null;
  error: unknown;
  get: () => ChatStore;
  isEditorCurrent: () => boolean;
  message: string;
  onPreflightFailure?: () => void;
  operationId: string;
  snapshot: { json: string | undefined };
}) => {
  if (error instanceof Error && (error.message.includes('aborted') || error.name === 'AbortError'))
    return;

  const store = get();
  store.updateOperationMetadata(operationId, {
    inputSendErrorMsg: error instanceof Error ? error.message : 'Unknown error',
  });
  const editorData = get().operations[operationId]?.metadata.inputEditorTempState;
  const restored =
    isEditorCurrent() && restoreSendEditorState(editor, editorData, message, snapshot);
  if (!restored) {
    store.retainFailedSendDraft(messageMapKey(context), {
      editorData,
      id: operationId,
      message,
    });
  }
  onPreflightFailure?.();
};

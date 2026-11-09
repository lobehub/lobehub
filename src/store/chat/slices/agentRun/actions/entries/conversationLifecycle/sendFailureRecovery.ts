import type { ChatContextContent, ConversationContext, PageSelection } from '@lobechat/types';

import type { ChatInputEditor } from '@/features/ChatInput';
import type { ChatStore } from '@/store/chat/store';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import type { UploadFileItem } from '@/types/files/upload';

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
  retainFailedDraft,
  retainFailedDraftOnRestore,
  onFailedSendDraftRetained,
  files,
  contextSelections,
  pageSelections,
  snapshot,
}: {
  context: ConversationContext;
  editor?: ChatInputEditor | null;
  error: unknown;
  get: () => ChatStore;
  isEditorCurrent: () => boolean;
  message: string;
  onPreflightFailure?: (editorRestored?: boolean, hasOperation?: boolean) => void;
  operationId: string;
  retainFailedDraft: boolean;
  retainFailedDraftOnRestore?: boolean;
  onFailedSendDraftRetained?: (id: string) => void;
  files?: UploadFileItem[];
  contextSelections?: ChatContextContent[];
  pageSelections?: PageSelection[];
  snapshot: { json: string | undefined };
}) => {
  if (error instanceof Error && (error.message.includes('aborted') || error.name === 'AbortError'))
    return;

  const store = get();
  store.updateOperationMetadata(operationId, {
    inputSendErrorMsg: error instanceof Error ? error.message : 'Unknown error',
  });
  const editorData = get().operations[operationId]?.metadata.inputEditorTempState ?? undefined;
  const restored =
    isEditorCurrent() && restoreSendEditorState(editor, editorData, message, snapshot);
  if (retainFailedDraft && (!restored || retainFailedDraftOnRestore)) {
    store.retainFailedSendDraft(messageMapKey(context), {
      contextSelections,
      editorData,
      files,
      id: operationId,
      message,
      pageSelections,
    });
    onFailedSendDraftRetained?.(operationId);
  }
  onPreflightFailure?.(restored, true);
};

export const createFailedSendRecovery =
  (params: Omit<Parameters<typeof recoverFailedSend>[0], 'error'>) => (error: unknown) =>
    recoverFailedSend({ ...params, error });

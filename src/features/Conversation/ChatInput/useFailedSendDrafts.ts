import { toast } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import { readDocument } from '@/features/ChatInput/editorDocument';
import { useConversationStoreApi } from '@/features/Conversation/store';
import { getAttachmentFileIdsFromEditor } from '@/features/EditorCanvas/editorAttachments';
import { useChatStore } from '@/store/chat';
import { restoreSendEditorState } from '@/store/chat/slices/agentRun/actions/entries/conversationLifecycle/sendEditorState';
import type { FailedSendDraft } from '@/store/chat/slices/message/initialState';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

const EMPTY_DRAFTS: FailedSendDraft[] = [];

export const useFailedSendDrafts = (contextKey: string) => {
  const { t } = useTranslation('chat');
  const conversationStore = useConversationStoreApi();
  const drafts = useChatStore((s) => s.failedSendDrafts[contextKey] ?? EMPTY_DRAFTS);
  const restore = (draft: FailedSendDraft) => {
    const { context, editor } = conversationStore.getState();
    if (messageMapKey(context) !== contextKey || !editor) return;
    const nativeEditor = editor.instance ?? editor;
    const markdown = readDocument(nativeEditor, 'markdown');
    if (
      typeof markdown !== 'string' ||
      markdown.trim() ||
      getAttachmentFileIdsFromEditor(nativeEditor).length
    ) {
      toast.info(t('input.failedSend.keepCurrentDraft'));
      return;
    }
    if (restoreSendEditorState(editor, draft.editorData, draft.message)) {
      useChatStore.getState().removeFailedSendDraft(contextKey, draft.id);
      editor.focus?.();
    }
  };

  return { drafts, restore };
};

import { nanoid } from '@lobechat/utils';
import type { IEditor } from '@lobehub/editor';
import { toast } from '@lobehub/ui';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { readDocument } from '@/features/ChatInput/editorDocument';
import { useConversationStore, useConversationStoreApi } from '@/features/Conversation/store';
import {
  getAttachmentFileIdsFromEditor,
  hasIncompleteEditorAttachments,
} from '@/features/EditorCanvas/editorAttachments';
import { useChatStore } from '@/store/chat';
import { restoreSendEditorState } from '@/store/chat/slices/agentRun/actions/entries/conversationLifecycle/sendEditorState';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { getServerConfigStoreState } from '@/store/serverConfig';

export const useTaskFollowUpSubmit = ({
  editor,
  onClear,
}: {
  editor?: IEditor | null;
  onClear: () => void;
}) => {
  const { t } = useTranslation('chat');
  const sendMessage = useConversationStore((s) => s.sendMessage);
  const conversationStore = useConversationStoreApi();
  const pending = useRef(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (pending.current || hasIncompleteEditorAttachments(editor ?? undefined)) return;
    const editorData = editor?.getDocument('json') as Record<string, unknown> | undefined;
    const markdown = String(editor?.getDocument('markdown') ?? '').trim();
    if (!markdown && getAttachmentFileIdsFromEditor(editor ?? undefined).length === 0) return;

    const config = getServerConfigStoreState()?.serverConfig;
    if (!config?.agentGatewayUrl || !config.enableGatewayMode) {
      toast.error(t('taskDetail.gatewayRequired'));
      return;
    }

    const contextKey = messageMapKey(conversationStore.getState().context);
    editor?.cleanDocument();
    const clearedDocument = JSON.stringify(readDocument(editor ?? undefined, 'json'));
    onClear();
    pending.current = true;
    setSubmitting(true);
    let recovered = false;
    const recoverPreflight = () => {
      if (recovered) return;
      recovered = true;
      const current = conversationStore.getState();
      const restored =
        current.editor === editor &&
        messageMapKey(current.context) === contextKey &&
        !!editor?.getLexicalEditor() &&
        JSON.stringify(readDocument(editor, 'json')) === clearedDocument &&
        restoreSendEditorState(editor, editorData, markdown);
      if (!restored) {
        useChatStore.getState().retainFailedSendDraft(contextKey, {
          editorData,
          id: nanoid(),
          message: markdown,
        });
      }
      toast.error(t('taskDetail.followUpFailed'));
    };
    try {
      // A task follow-up keeps its original run's server runtime.
      await sendMessage({
        editorData,
        forceRuntime: 'gateway',
        message: markdown,
        onBeforeSendFailure: recoverPreflight,
      });
    } catch {
      recoverPreflight();
    } finally {
      pending.current = false;
      setSubmitting(false);
    }
  };

  return { handleSubmit, submitting };
};

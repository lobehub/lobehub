import type { IEditor } from '@lobehub/editor';
import { toast } from '@lobehub/ui';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { readDocument, writeDocument } from '@/features/ChatInput/editorDocument';
import { useConversationStore, useConversationStoreApi } from '@/features/Conversation/store';
import {
  getAttachmentFileIdsFromEditor,
  hasIncompleteEditorAttachments,
} from '@/features/EditorCanvas/editorAttachments';
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
    if (pending.current || hasIncompleteEditorAttachments(editor)) return;
    const editorData = editor?.getDocument('json') as Record<string, unknown> | undefined;
    const markdown = String(editor?.getDocument('markdown') ?? '').trim();
    if (!markdown && getAttachmentFileIdsFromEditor(editor).length === 0) return;

    const config = getServerConfigStoreState()?.serverConfig;
    if (!config?.agentGatewayUrl || !config.enableGatewayMode) {
      toast.error(t('taskDetail.gatewayRequired'), { id: 'task-follow-up-gateway' });
      return;
    }

    const contextKey = messageMapKey(conversationStore.getState().context);
    editor?.cleanDocument();
    const clearedDocument = JSON.stringify(readDocument(editor ?? undefined, 'json'));
    onClear();
    pending.current = true;
    setSubmitting(true);
    try {
      // A task follow-up must use the same server runtime as its original run,
      // regardless of the user's preference for ordinary chat.
      await sendMessage({ editorData, forceRuntime: 'gateway', message: markdown });
    } catch {
      // Preflight hooks can reject before ChatStore owns recovery.
      const current = conversationStore.getState();
      if (
        current.editor === editor &&
        messageMapKey(current.context) === contextKey &&
        JSON.stringify(readDocument(editor ?? undefined, 'json')) === clearedDocument
      ) {
        writeDocument(
          editor ?? undefined,
          editorData ? 'json' : 'markdown',
          editorData ? JSON.stringify(editorData) : markdown,
        );
      }
      toast.error(t('taskDetail.followUpFailed'), { id: 'task-follow-up-failed' });
    } finally {
      pending.current = false;
      setSubmitting(false);
    }
  };

  return { handleSubmit, submitting };
};

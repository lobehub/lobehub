import { toast } from '@lobehub/ui';
import { Undo2 } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { useFileStore } from '@/store/file';

import { useConversationStore } from '../../../../store';
import { defineAction } from '../defineAction';
import { buildRestoredInput } from './buildRestoredInput';

/**
 * Restore a previously sent user message — its text plus every image/file
 * attachment — back into the ChatInput composer, so the user can resend it.
 *
 * Motivated by long agent runs that error out or lose memory: re-attaching a
 * pile of images by hand is painful, so we rebuild the exact input state from
 * the persisted message instead.
 */
export const restoreToInputAction = defineAction({
  key: 'restoreToInput',
  useBuild: (ctx) => {
    const { t } = useTranslation('common');

    const editor = useConversationStore((s) => s.editor);
    const contextKey = useConversationStore((s) => messageMapKey(s.context));
    const updateInputMessage = useConversationStore((s) => s.updateInputMessage);

    return useMemo(() => {
      // Only user messages carry restorable user input.
      if (ctx.role !== 'user') return null;

      return {
        handleClick: () => {
          if (!editor) return;

          const { editorData, files, markdown } = buildRestoredInput(ctx.data);

          // 1. Restore text. Prefer the persisted editor JSON (round-trips rich
          //    formatting) and fall back to the markdown content otherwise.
          if (editorData) {
            editor.setJSONState(editorData);
          } else {
            editor.setDocument('markdown', markdown);
          }
          // Keep ConversationStore's inputMessage in sync — setDocument does not
          // fire onMarkdownContentChange, and the send-button gating reads it.
          updateInputMessage(markdown);

          // 2. Rebuild the pending attachments.
          const fileStore = useFileStore.getState();
          fileStore.clearChatUploadFileList(contextKey);
          if (files.length > 0) {
            fileStore.dispatchChatUploadFileList(contextKey, { files, type: 'addFiles' });
          }

          editor.focus();
          toast.success(t('restoreToInputSuccess'));
        },
        icon: Undo2,
        key: 'restoreToInput',
        label: t('restoreToInput'),
      };
    }, [t, ctx.role, ctx.data, contextKey, editor, updateInputMessage]);
  },
});

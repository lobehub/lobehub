import { SendButton, useEditor } from '@lobehub/editor/react';
import { Avatar, Flexbox } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { $getRoot } from 'lexical';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AttachmentUploadButton } from '@/features/AttachmentInput';
import { mentionPlainClassName } from '@/features/ChatInput/InputEditor/mentionStyle';
import { EditorCanvas } from '@/features/EditorCanvas';
import {
  getAttachmentFileIdsFromEditor,
  insertFilesIntoEditor,
} from '@/features/EditorCanvas/editorAttachments';
import { useWorkspaceCommentMentionOption } from '@/features/Portal/TopicComments/useWorkspaceCommentMentionOption';
import { useEnterToSend } from '@/hooks/useEnterToSend';
import { usePermission } from '@/hooks/usePermission';
import { useUserAvatar } from '@/hooks/useUserAvatar';

import { styles } from '../shared/style';
import { useCommentSubmit } from './useCommentSubmit';

const CommentInput = memo<{ taskId: string }>(({ taskId }) => {
  const { t } = useTranslation('chat');
  const { allowed: canEditTask } = usePermission('create_content');
  const editor = useEditor();
  const userAvatar = useUserAvatar();
  const [hasContent, setHasContent] = useState(false);
  const [hasAttachments, setHasAttachments] = useState(false);
  const shouldSendOnEnter = useEnterToSend();
  // Same member source as document / topic comments, so `@` produces the
  // identical mention node the server resolves for notifications.
  const mentionOption = useWorkspaceCommentMentionOption();

  const canSubmit = hasContent || hasAttachments;

  const handleContentChange = useCallback(() => {
    const lexicalEditor = editor?.getLexicalEditor?.();
    if (!lexicalEditor) return;
    lexicalEditor.getEditorState().read(() => {
      const text = $getRoot().getTextContent().trim();
      setHasContent(text.length > 0);
    });
    setHasAttachments(getAttachmentFileIdsFromEditor(editor).length > 0);
  }, [editor]);

  const handleAttach = useCallback(
    (files: File[]) => {
      insertFilesIntoEditor(editor, files);
    },
    [editor],
  );

  const handleContentReset = useCallback(
    (state: { hasAttachments: boolean; hasContent: boolean }) => {
      setHasContent(state.hasContent);
      setHasAttachments(state.hasAttachments);
    },
    [],
  );

  const { submit: handleSubmit, submitting } = useCommentSubmit({
    canComment: canEditTask,
    editor,
    onContentReset: handleContentReset,
    taskId,
  });

  return (
    <Flexbox className={stylex.props(styles.commentInputCard).className} gap={6}>
      <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0, width: '100%' }}>
        <Avatar avatar={userAvatar} size={24} style={{ flexShrink: 0 }} />
        <div
          className={mentionPlainClassName}
          style={{ flex: '1 1 0', minWidth: 0, overflow: 'hidden' }}
        >
          <EditorCanvas
            editor={editor}
            floatingToolbar={false}
            mentionOption={mentionOption}
            placeholder={t('taskDetail.commentPlaceholder')}
            style={{
              fontSize: 14,
              maxWidth: '100%',
              minHeight: 24,
              overflow: 'hidden',
              paddingBlock: 0,
              whiteSpace: 'normal',
            }}
            onContentChange={handleContentChange}
            onPressEnter={({ event }) => {
              if (!canEditTask) return true;
              if (shouldSendOnEnter(event)) {
                handleSubmit();
                return true;
              }
            }}
          />
        </div>
        <Flexbox horizontal align={'center'} gap={4} style={{ flexShrink: 0 }}>
          <AttachmentUploadButton onFiles={handleAttach} />
          <SendButton
            disabled={!canEditTask || (!canSubmit && !submitting)}
            loading={submitting}
            shape={'round'}
            type={'text'}
            onClick={handleSubmit}
          />
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
});

export default CommentInput;

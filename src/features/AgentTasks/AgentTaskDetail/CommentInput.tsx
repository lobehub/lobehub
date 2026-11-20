import { SendButton, useEditor } from '@lobehub/editor/react';
import { Avatar, Flexbox } from '@lobehub/ui';
import { $getRoot } from 'lexical';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AttachmentUploadButton } from '@/features/AttachmentInput';
import { mentionPlainClassName } from '@/features/ChatInput/InputEditor/mentionStyle';
import { EditorCanvas } from '@/features/EditorCanvas';
import {
  getAttachmentFileIdsFromEditor,
  hasIncompleteEditorAttachments,
  insertFilesIntoEditor,
} from '@/features/EditorCanvas/editorAttachments';
import { useEnterToSend } from '@/hooks/useEnterToSend';
import { usePermission } from '@/hooks/usePermission';
import { useUserAvatar } from '@/hooks/useUserAvatar';

import { styles } from '../shared/style';
import { useCommentSubmit } from './useCommentSubmit';
import { useTaskCommentMentionOption } from './useTaskCommentMentionOption';

interface CommentInputProps {
  /** Put the caret in the editor on mount — a reply box opened on request. */
  autoFocus?: boolean;
  /** Escape in an empty editor; a reply box opened on request closes itself. */
  onCancel?: () => void;
  /** Called once the comment is saved. */
  onSubmitted?: () => void;
  /** Reply in this comment's thread instead of starting a new one. */
  parentCommentId?: string;
  placeholder?: string;
  taskId: string;
}

const CommentInput = memo<CommentInputProps>(
  ({ autoFocus, onCancel, onSubmitted, parentCommentId, placeholder, taskId }) => {
    const { t } = useTranslation('chat');
    const { allowed: canEditTask } = usePermission('create_content');
    const editor = useEditor();
    const userAvatar = useUserAvatar();
    const [hasContent, setHasContent] = useState(false);
    const [hasAttachments, setHasAttachments] = useState(false);
    const [uploadingAttachments, setUploadingAttachments] = useState(false);
    const shouldSendOnEnter = useEnterToSend();
    // Members (same source as document / topic comments, so `@` produces the
    // mention node the server resolves for notifications) plus the agents a
    // mention can wake.
    const mentionOption = useTaskCommentMentionOption();

    useEffect(() => {
      if (!autoFocus || !editor) return;
      // The editor mounts its root after this effect; focus once it is there.
      const frame = requestAnimationFrame(() => editor.focus());
      return () => cancelAnimationFrame(frame);
    }, [autoFocus, editor]);

    // A still-uploading image would be sent as its local `blob:` preview URL.
    const canSubmit = (hasContent || hasAttachments) && !uploadingAttachments;

    const handleContentChange = useCallback(() => {
      const lexicalEditor = editor?.getLexicalEditor?.();
      if (!lexicalEditor) return;
      lexicalEditor.getEditorState().read(() => {
        const text = $getRoot().getTextContent().trim();
        setHasContent(text.length > 0);
      });
      setHasAttachments(getAttachmentFileIdsFromEditor(editor).length > 0);
      setUploadingAttachments(hasIncompleteEditorAttachments(editor));
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
        setUploadingAttachments(hasIncompleteEditorAttachments(editor));
      },
      [editor],
    );

    const { submit: handleSubmit, submitting } = useCommentSubmit({
      canComment: canEditTask,
      editor,
      onContentReset: handleContentReset,
      onSubmitted,
      parentCommentId,
      taskId,
    });

    return (
      <Flexbox className={styles.commentInputCard} gap={6}>
        <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0, width: '100%' }}>
          <Avatar avatar={userAvatar} size={24} style={{ flexShrink: 0 }} />
          <div
            className={mentionPlainClassName}
            style={{ flex: '1 1 0', minWidth: 0, overflow: 'hidden' }}
            onKeyDown={
              onCancel
                ? (event) => {
                    // Only an empty box closes: Escape must not throw away a draft.
                    if (event.key !== 'Escape' || hasContent || hasAttachments) return;
                    event.preventDefault();
                    onCancel();
                  }
                : undefined
            }
          >
            <EditorCanvas
              editor={editor}
              floatingToolbar={false}
              mentionOption={mentionOption}
              placeholder={placeholder ?? t('taskDetail.commentPlaceholder')}
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
  },
);

CommentInput.displayName = 'TaskCommentInput';

export default CommentInput;

import { SendButton, useEditor } from '@lobehub/editor/react';
import { Avatar, Flexbox } from '@lobehub/ui';
import { $getRoot } from 'lexical';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { shallow } from 'zustand/shallow';

import { AttachmentUploadButton } from '@/features/AttachmentInput';
import { EditorCanvas } from '@/features/EditorCanvas';
import {
  getAttachmentFileIdsFromEditor,
  insertFilesIntoEditor,
} from '@/features/EditorCanvas/editorAttachments';
import { useEnterToSend } from '@/hooks/useEnterToSend';
import { useUserAvatar } from '@/hooks/useUserAvatar';
import { useTaskStore } from '@/store/task';

import { styles } from '../../shared/style';

interface FeedbackInputProps {
  taskId: string;
  topicId: string;
}

const FeedbackInput = memo<FeedbackInputProps>(({ taskId, topicId }) => {
  const { t } = useTranslation('chat');
  const editor = useEditor();
  const userAvatar = useUserAvatar();
  const { addComment, runTask, closeTopicDrawer } = useTaskStore(
    (s) => ({
      addComment: s.addComment,
      closeTopicDrawer: s.closeTopicDrawer,
      runTask: s.runTask,
    }),
    shallow,
  );
  const [submitting, setSubmitting] = useState(false);
  const [hasContent, setHasContent] = useState(false);
  const [hasAttachments, setHasAttachments] = useState(false);
  const shouldSendOnEnter = useEnterToSend();

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

  const handleSubmit = useCallback(async () => {
    if (submitting) return;
    const json = editor?.getDocument?.('json') as unknown;
    const markdown = String(editor?.getDocument?.('markdown') ?? '').trim();
    const hasFiles = getAttachmentFileIdsFromEditor(editor).length > 0;
    if (!markdown && !hasFiles) return;

    setSubmitting(true);
    try {
      await addComment(taskId, markdown, {
        editorData: json,
        topicId,
      });
      // Start a NEW topic run that picks up the comment we just attached to the
      // current topic. Do NOT pass continueTopicId — that would flip the
      // already-completed topic back to running and overwrite its operation id.
      try {
        await runTask(taskId);
      } catch (error) {
        console.warn('[FeedbackInput] runTask failed', error);
      }
      editor?.cleanDocument?.();
      setHasContent(false);
      setHasAttachments(false);
      closeTopicDrawer();
    } finally {
      setSubmitting(false);
    }
  }, [taskId, topicId, editor, addComment, runTask, closeTopicDrawer, submitting]);

  return (
    <Flexbox className={styles.commentInputCard} gap={6}>
      <Flexbox horizontal align={'flex-start'} gap={8}>
        <Avatar avatar={userAvatar} size={24} style={{ flexShrink: 0, marginBlockStart: 4 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <EditorCanvas
            editor={editor}
            floatingToolbar={false}
            placeholder={t('taskDetail.commentPlaceholder')}
            style={{ paddingBottom: 4 }}
            onContentChange={handleContentChange}
            onPressEnter={({ event }) => {
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
            disabled={!canSubmit && !submitting}
            loading={submitting}
            shape={'round'}
            title={t('taskDetail.commentSubmitAndRun')}
            type={'text'}
            onClick={handleSubmit}
          />
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
});

export default FeedbackInput;

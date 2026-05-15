import { Editor, SendButton, useEditor } from '@lobehub/editor/react';
import { Avatar, Flexbox } from '@lobehub/ui';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { shallow } from 'zustand/shallow';

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

  const handleSubmit = useCallback(async () => {
    const trimmed = String(editor?.getDocument?.('markdown') ?? '').trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      await addComment(taskId, trimmed, { topicId });
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
      closeTopicDrawer();
    } finally {
      setSubmitting(false);
    }
  }, [taskId, topicId, editor, addComment, runTask, closeTopicDrawer, submitting]);

  return (
    <Flexbox horizontal align={'center'} className={styles.commentInputCard} gap={8}>
      <Avatar avatar={userAvatar} size={24} style={{ flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <Editor
          content={''}
          editor={editor}
          enablePasteMarkdown={false}
          markdownOption={false}
          placeholder={t('taskDetail.commentPlaceholder')}
          type={'text'}
          variant={'chat'}
          onChange={(ed) => {
            setHasContent(!ed?.isEmpty);
          }}
          onPressEnter={({ event }) => {
            if (event.metaKey || event.ctrlKey) {
              handleSubmit();
              return true;
            }
          }}
        />
      </div>
      <div style={{ flexShrink: 0 }}>
        <SendButton
          disabled={!hasContent && !submitting}
          loading={submitting}
          shape={'round'}
          title={t('taskDetail.commentSubmitAndRun')}
          type={'text'}
          onClick={handleSubmit}
        />
      </div>
    </Flexbox>
  );
});

export default FeedbackInput;

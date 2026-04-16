import { ChatInput, Editor, SendButton, useEditor } from '@lobehub/editor/react';
import { Flexbox } from '@lobehub/ui';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useTaskStore } from '@/store/task';

const CommentInput = memo<{ taskId: string }>(({ taskId }) => {
  const { t } = useTranslation('chat');
  const editor = useEditor();
  const addComment = useTaskStore((s) => s.addComment);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = useCallback(async () => {
    const trimmed = String(editor?.getDocument?.('markdown') ?? '').trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      await addComment(taskId, trimmed);
      editor?.clearContent?.();
    } finally {
      setSubmitting(false);
    }
  }, [taskId, editor, addComment, submitting]);

  return (
    <ChatInput
      gap={8}
      maxHeight={100}
      minHeight={30}
      resize={false}
      footer={
        <Flexbox horizontal align={'center'} justify={'flex-end'} padding={8}>
          <SendButton
            loading={submitting}
            shape={'round'}
            type={'primary'}
            onClick={handleSubmit}
          />
        </Flexbox>
      }
    >
      <Editor
        content={''}
        editor={editor}
        enablePasteMarkdown={false}
        markdownOption={false}
        placeholder={t('taskDetail.commentPlaceholder')}
        type={'text'}
        variant={'chat'}
        onPressEnter={({ event }) => {
          if (event.metaKey || event.ctrlKey) {
            handleSubmit();
            return true;
          }
        }}
      />
    </ChatInput>
  );
});

export default CommentInput;

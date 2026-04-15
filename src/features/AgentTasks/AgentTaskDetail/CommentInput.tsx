import { ChatInput, SendButton, useEditor } from '@lobehub/editor/react';
import { Flexbox, TextArea } from '@lobehub/ui';
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

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

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
      <TextArea
        autoSize={{ maxRows: 4, minRows: 1 }}
        placeholder={t('taskDetail.commentPlaceholder')}
        style={{ padding: 0 }}
        variant={'borderless'}
        onKeyDown={handleKeyDown}
      />
    </ChatInput>
  );
});

export default CommentInput;

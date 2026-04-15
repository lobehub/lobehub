import { ChatInput } from '@lobehub/editor/react';
import { ActionIcon, Flexbox } from '@lobehub/ui';
import { Input } from 'antd';
import { ArrowUp } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useTaskStore } from '@/store/task';

import { styles } from '../shared/style';

const CommentInput = memo<{ taskId: string }>(({ taskId }) => {
  const { t } = useTranslation('chat');
  const addComment = useTaskStore((s) => s.addComment);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const hasComment = comment.trim().length > 0;

  const handleSubmit = useCallback(async () => {
    const trimmed = comment.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      await addComment(taskId, trimmed);
      setComment('');
    } finally {
      setSubmitting(false);
    }
  }, [taskId, comment, addComment, submitting]);

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
    <ChatInput resize={false}>
      <Input.TextArea
        autoSize={{ maxRows: 8, minRows: 3 }}
        className={styles.commentInput}
        placeholder={t('taskDetail.commentPlaceholder')}
        value={comment}
        variant="borderless"
        onChange={(e) => setComment(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <Flexbox horizontal className={styles.commentActions} gap={4}>
        <ActionIcon
          disabled={!hasComment || submitting}
          icon={ArrowUp}
          loading={submitting}
          size="small"
          onClick={handleSubmit}
        />
      </Flexbox>
    </ChatInput>
  );
});

export default CommentInput;

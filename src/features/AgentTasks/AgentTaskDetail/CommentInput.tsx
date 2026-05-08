import { Editor, SendButton, useEditor } from '@lobehub/editor/react';
import { Avatar, Flexbox } from '@lobehub/ui';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useUserAvatar } from '@/hooks/useUserAvatar';
import { useTaskStore } from '@/store/task';

import { styles } from '../shared/style';

const CommentInput = memo<{ taskId: string }>(({ taskId }) => {
  const { t } = useTranslation('chat');
  const editor = useEditor();
  const addComment = useTaskStore((s) => s.addComment);
  const userAvatar = useUserAvatar();
  const [submitting, setSubmitting] = useState(false);
  const [hasContent, setHasContent] = useState(false);

  const handleSubmit = useCallback(async () => {
    const trimmed = String(editor?.getDocument?.('markdown') ?? '').trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      await addComment(taskId, trimmed);
      editor?.cleanDocument?.();
      setHasContent(false);
    } finally {
      setSubmitting(false);
    }
  }, [taskId, editor, addComment, submitting]);

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
          onPressEnter={({ event }) => {
            if (event.metaKey || event.ctrlKey) {
              handleSubmit();
              return true;
            }
          }}
          onTextChange={(ed) => {
            setHasContent(!!String(ed?.getDocument?.('markdown') ?? '').trim());
          }}
        />
      </div>
      <div
        style={{
          flexShrink: 0,
          opacity: hasContent || submitting ? 1 : 0,
          pointerEvents: hasContent || submitting ? 'auto' : 'none',
        }}
      >
        <SendButton loading={submitting} shape={'round'} type={'text'} onClick={handleSubmit} />
      </div>
    </Flexbox>
  );
});

export default CommentInput;

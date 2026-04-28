import { ChatInput, Editor, SendButton, useEditor } from '@lobehub/editor/react';
import { Button, Flexbox } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { ChevronLeft } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface CommentInputProps {
  onCancel: () => void;
  onSubmit: (text: string) => Promise<void> | void;
}

const CommentInput = memo<CommentInputProps>(({ onSubmit, onCancel }) => {
  const { t } = useTranslation('home');
  const editor = useEditor();
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = useCallback(async () => {
    const content = String(editor?.getDocument?.('markdown') ?? '').trim();
    if (!content || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(content);
    } finally {
      setSubmitting(false);
    }
  }, [editor, onSubmit, submitting]);

  return (
    <ChatInput
      gap={8}
      maxHeight={100}
      minHeight={30}
      resize={false}
      footer={
        <Flexbox horizontal align={'center'} gap={8} justify={'space-between'} padding={8}>
          <Button
            disabled={submitting}
            icon={ChevronLeft}
            size={'small'}
            type={'text'}
            style={{
              color: cssVar.colorTextDescription,
            }}
            onClick={onCancel}
          >
            {t('cancel', { ns: 'common' })}
          </Button>
          <SendButton
            loading={submitting}
            shape={'round'}
            title={t('brief.commentSubmit')}
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
        placeholder={t('brief.commentPlaceholder')}
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

import {
  ReactCodemirrorPlugin,
  ReactCodePlugin,
  ReactHRPlugin,
  ReactLinkHighlightPlugin,
  ReactListPlugin,
} from '@lobehub/editor';
import { Editor, useEditor } from '@lobehub/editor/react';
import { Button, Flexbox } from '@lobehub/ui';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { styles } from './style';

const PLUGINS = [
  ReactListPlugin,
  ReactCodePlugin,
  ReactCodemirrorPlugin,
  ReactHRPlugin,
  ReactLinkHighlightPlugin,
];

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
    <Flexbox gap={8}>
      <div className={styles.editorWrapper}>
        <Editor
          content={''}
          editor={editor}
          placeholder={t('brief.commentPlaceholder')}
          plugins={PLUGINS}
          style={{ minHeight: 60 }}
          type={'text'}
        />
      </div>
      <Flexbox horizontal gap={8} justify={'flex-end'}>
        <Button disabled={submitting} size={'small'} type={'text'} onClick={onCancel}>
          {t('cancel', { ns: 'common' })}
        </Button>
        <Button loading={submitting} size={'small'} type={'primary'} onClick={handleSubmit}>
          {t('brief.commentSubmit')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

export default CommentInput;

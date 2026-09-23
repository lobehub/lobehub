'use client';

import { ActionIcon, Input, toast } from '@lobehub/ui/base-ui';
import { SendHorizontal } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useIMECompositionEvent } from '@/hooks/useIMECompositionEvent';
import { quickNoteSelectors, useQuickNoteStore } from '@/store/quickNote';

const CommentComposer = memo<{ noteId: string }>(({ noteId }) => {
  const { t } = useTranslation('note');
  const [comment, setComment] = useState('');
  const createComment = useQuickNoteStore((s) => s.createComment);
  const creatingComment = useQuickNoteStore(quickNoteSelectors.isCreatingComment(noteId));
  const { compositionProps, isComposingRef } = useIMECompositionEvent();

  const submit = async () => {
    if (!comment.trim() || creatingComment) return;
    try {
      await createComment(noteId, comment);
      setComment('');
    } catch {
      toast.error(t('agentic.actionFailed'));
    }
  };

  return (
    <Input
      placeholder={t('agentic.comment.placeholder')}
      suffix={<ActionIcon icon={SendHorizontal} loading={creatingComment} onClick={submit} />}
      value={comment}
      onChange={(event) => setComment(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !isComposingRef.current) {
          event.preventDefault();
          void submit();
        }
      }}
      {...compositionProps}
    />
  );
});

CommentComposer.displayName = 'QuickNoteCommentComposer';

export default CommentComposer;

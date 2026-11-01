'use client';

import { Button, cssVar, Flexbox, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { Pencil } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { QuickNoteComment } from '@/services/quickNote';
import { useQuickNoteStore } from '@/store/quickNote';

import { formatNoteTime } from '../utils';
import SectionLabel from './SectionLabel';
import { styles } from './style';
import { openQuickNoteTextEditModal, quickNoteTextEditTitles } from './TextEditModal';

const CommentItem = memo<{ comment: QuickNoteComment; noteId: string }>(({ comment, noteId }) => {
  const { t } = useTranslation('note');
  const updateComment = useQuickNoteStore((s) => s.updateComment);

  const openEditor = () =>
    openQuickNoteTextEditModal({
      initialValue: comment.content,
      onSave: (content) => updateComment(noteId, comment.id, content),
      rows: { maxRows: 6, minRows: 2 },
      title: quickNoteTextEditTitles.comment(),
    });

  return (
    <Flexbox className={stylex.props(styles.sidecarCard).className} gap={8}>
      <Text fontSize={13}>{comment.content}</Text>
      <Flexbox horizontal align={'center'} gap={6} justify={'space-between'}>
        <Text color={cssVar.colorTextQuaternary} fontSize={11}>
          {formatNoteTime(comment.updatedAt)}
        </Text>
        <Button
          aria-label={t('agentic.comment.edit')}
          icon={Pencil}
          type={'text'}
          onClick={openEditor}
        />
      </Flexbox>
    </Flexbox>
  );
});

CommentItem.displayName = 'QuickNoteCommentItem';

const Comments = memo<{ comments: QuickNoteComment[]; noteId: string }>(({ comments, noteId }) => {
  const { t } = useTranslation('note');

  if (comments.length === 0) return null;

  return (
    <Flexbox gap={8}>
      <SectionLabel title={t('agentic.comment.title')} />
      {comments.map((item) => (
        <CommentItem comment={item} key={item.id} noteId={noteId} />
      ))}
    </Flexbox>
  );
});

Comments.displayName = 'QuickNoteComments';

export default Comments;

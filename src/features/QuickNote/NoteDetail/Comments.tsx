'use client';

import { Flexbox, TextArea } from '@lobehub/ui';
import { Button, Text, toast } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { Check, Pencil, X } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { QuickNoteComment } from '@/services/quickNote';
import { quickNoteSelectors, useQuickNoteStore } from '@/store/quickNote';

import { formatNoteTime } from '../utils';
import SectionLabel from './SectionLabel';
import { styles } from './style';

const CommentItem = memo<{ comment: QuickNoteComment; noteId: string }>(({ comment, noteId }) => {
  const { t } = useTranslation('note');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.content);
  const updateComment = useQuickNoteStore((s) => s.updateComment);
  const saving = useQuickNoteStore(quickNoteSelectors.isEditingComment(comment.id));

  const save = async () => {
    try {
      await updateComment(noteId, comment.id, draft);
      setEditing(false);
    } catch {
      toast.error(t('agentic.actionFailed'));
    }
  };

  return (
    <Flexbox className={styles.sidecarCard} gap={8}>
      {editing ? (
        <TextArea
          autoFocus
          autoSize={{ maxRows: 6, minRows: 2 }}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      ) : (
        <Text fontSize={13}>{comment.content}</Text>
      )}
      <Flexbox horizontal align={'center'} gap={6} justify={'space-between'}>
        <Text color={cssVar.colorTextQuaternary} fontSize={11}>
          {formatNoteTime(comment.updatedAt)}
        </Text>
        {editing ? (
          <Flexbox horizontal gap={4}>
            <Button
              aria-label={t('agentic.comment.cancelEdit')}
              icon={X}
              type={'text'}
              onClick={() => {
                setDraft(comment.content);
                setEditing(false);
              }}
            />
            <Button
              aria-label={t('agentic.comment.save')}
              disabled={!draft.trim()}
              icon={Check}
              loading={saving}
              type={'primary'}
              onClick={save}
            />
          </Flexbox>
        ) : (
          <Button
            aria-label={t('agentic.comment.edit')}
            icon={Pencil}
            type={'text'}
            onClick={() => setEditing(true)}
          />
        )}
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

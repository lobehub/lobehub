import type { DocumentCommentItem } from '@lobechat/types';
import { ActionIcon, Avatar, Flexbox, Markdown, Text, TextArea } from '@lobehub/ui';
import { Button, confirmModal, toast } from '@lobehub/ui/base-ui';
import { ChevronRight, MessageCircle, Pencil, Trash } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActivityTime } from '@/hooks/useActivityTime';
import { documentCommentService } from '@/services/documentComment';

import type { DocumentCommentUpdateHandler } from './optimistic';
import { isOptimisticDocumentComment } from './optimistic';
import { styles } from './styles';

interface CommentCardProps {
  comment: DocumentCommentItem;
  onMutated: () => void | Promise<void>;
  onReply?: () => void;
  onUpdate: DocumentCommentUpdateHandler;
  replying?: boolean;
  variant?: 'reply' | 'root';
}

const CommentCard = memo<CommentCardProps>(
  ({ comment, onMutated, onReply, onUpdate, replying, variant = 'root' }) => {
    const { t } = useTranslation('file');
    const { text: time, title: timeTitle } = useActivityTime(comment.createdAt);
    const [editing, setEditing] = useState(false);
    const [content, setContent] = useState(comment.content);
    const [mutating, setMutating] = useState(false);
    const deleted = Boolean(comment.deletedAt);
    const optimistic = isOptimisticDocumentComment(comment);
    const authorName =
      comment.author.fullName ||
      comment.author.username ||
      t('pageEditor.comments.author.deactivated');
    const replyToName =
      comment.replyTo?.author.fullName ||
      comment.replyTo?.author.username ||
      (comment.replyTo ? t('pageEditor.comments.author.deactivated') : null);
    const edited = new Date(comment.updatedAt).getTime() > new Date(comment.createdAt).getTime();

    const handleUpdate = useCallback(async () => {
      const nextContent = content.trim();
      if (!nextContent || mutating) return;
      setMutating(true);
      setEditing(false);
      try {
        await onUpdate(comment, nextContent);
      } catch {
        setContent(comment.content);
        setEditing(true);
        toast.error(t('pageEditor.comments.updateFailed'));
      } finally {
        setMutating(false);
      }
    }, [comment, content, mutating, onUpdate, t]);

    const handleDelete = useCallback(() => {
      confirmModal({
        content: t('pageEditor.comments.deleteConfirm.content'),
        okButtonProps: { danger: true },
        okText: t('pageEditor.comments.delete'),
        onOk: async () => {
          setMutating(true);
          try {
            await documentCommentService.delete(comment.id);
            await onMutated();
          } catch {
            toast.error(t('pageEditor.comments.deleteFailed'));
            throw new Error('Failed to delete document comment');
          } finally {
            setMutating(false);
          }
        },
        title: t('pageEditor.comments.deleteConfirm.title'),
      });
    }, [comment.id, onMutated, t]);

    const handleEdit = useCallback(() => {
      setContent(comment.content);
      setEditing(true);
    }, [comment.content]);

    return (
      <Flexbox
        className={`${styles.card} ${variant === 'reply' ? styles.replyCard : ''}`}
        data-document-comment-id={comment.id}
      >
        <Flexbox horizontal align={'center'} className={styles.header} gap={8}>
          <Avatar
            avatar={comment.author.avatar || authorName}
            size={variant === 'reply' ? 28 : 32}
          />
          <Text fontSize={14} weight={600}>
            {authorName}
          </Text>
          {replyToName && (
            <>
              <ChevronRight aria-hidden className={styles.replyTargetIcon} size={14} />
              <Text fontSize={14} weight={600}>
                {replyToName}
              </Text>
            </>
          )}
          {comment.author.status === 'former' && (
            <Text className={styles.meta} fontSize={12}>
              {t('pageEditor.comments.author.former')}
            </Text>
          )}
          {time && (
            <Text className={styles.meta} fontSize={14} title={timeTitle}>
              {time}
            </Text>
          )}
          {edited && !deleted && (
            <Text className={styles.meta} fontSize={12}>
              {t('pageEditor.comments.edited')}
            </Text>
          )}
        </Flexbox>

        <div className={`${styles.body} ${variant === 'reply' ? styles.replyBody : ''}`}>
          {deleted ? (
            <Text className={styles.deleted}>{t('pageEditor.comments.deleted')}</Text>
          ) : editing ? (
            <Flexbox gap={8}>
              <TextArea
                autoFocus
                autoSize={{ maxRows: 8, minRows: 2 }}
                className={styles.editArea}
                disabled={mutating}
                maxLength={10_000}
                value={content}
                onChange={(event) => setContent(event.target.value)}
              />
              <Flexbox horizontal gap={8} justify={'flex-end'}>
                <Button disabled={mutating} size={'small'} onClick={() => setEditing(false)}>
                  {t('pageEditor.comments.cancel')}
                </Button>
                <Button loading={mutating} size={'small'} type={'primary'} onClick={handleUpdate}>
                  {t('pageEditor.comments.save')}
                </Button>
              </Flexbox>
            </Flexbox>
          ) : (
            <Markdown fontSize={16} variant={'chat'}>
              {mutating ? content : comment.content}
            </Markdown>
          )}
        </div>

        {!optimistic && !editing && (onReply || comment.canEdit || comment.canDelete) && (
          <Flexbox
            horizontal
            className={`${styles.actions} ${variant === 'reply' ? styles.replyCardActions : ''}`}
            gap={4}
          >
            {onReply && (
              <ActionIcon
                aria-label={t('pageEditor.comments.replyAction')}
                aria-pressed={replying}
                disabled={mutating}
                icon={MessageCircle}
                size={'small'}
                title={t('pageEditor.comments.replyAction')}
                onClick={onReply}
              />
            )}
            {comment.canEdit && (
              <ActionIcon
                aria-label={t('pageEditor.comments.edit')}
                disabled={mutating}
                icon={Pencil}
                size={'small'}
                title={t('pageEditor.comments.edit')}
                onClick={handleEdit}
              />
            )}
            {comment.canDelete && (
              <ActionIcon
                aria-label={t('pageEditor.comments.delete')}
                icon={Trash}
                loading={mutating}
                size={'small'}
                title={t('pageEditor.comments.delete')}
                onClick={handleDelete}
              />
            )}
          </Flexbox>
        )}
      </Flexbox>
    );
  },
);

CommentCard.displayName = 'DocumentCommentCard';

export default CommentCard;

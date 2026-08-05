import type { TopicCommentItem } from '@lobechat/types';
import { ActionIcon, Avatar, Flexbox, Icon, Markdown, Text } from '@lobehub/ui';
import type { DropdownItem } from '@lobehub/ui/base-ui';
import { Button, confirmModal, DropdownMenu, toast } from '@lobehub/ui/base-ui';
import { MessageCircle, MoreHorizontal, Pencil, Trash } from 'lucide-react';
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import RichTextMessage from '@/features/Conversation/Messages/User/components/RichTextMessage';
import { useTopicCommentMutations } from '@/features/TopicComment/hooks';
import { useActivityTime } from '@/hooks/useActivityTime';

import AnchorPreview from './AnchorPreview';
import { createTopicCommentUpdateInput, hasTopicCommentEditorData } from './commentContent';
import { styles } from './styles';
import TopicCommentEditor, {
  type TopicCommentEditorRef,
  type TopicCommentEditorValue,
} from './TopicCommentEditor';

interface CommentCardProps {
  comment: TopicCommentItem;
  onDeleted?: (mode: 'hard' | 'moderated' | 'soft') => void;
  onMutated?: () => void;
  onOpenThread?: () => void;
  pending?: boolean;
  replyCount?: number;
  replyStyle?: boolean;
  rootReplyCount?: number;
}

const CommentContent = memo<Pick<TopicCommentItem, 'content' | 'editorData'>>(
  ({ content, editorData }) => {
    return hasTopicCommentEditorData(editorData) ? (
      <RichTextMessage editorState={editorData} />
    ) : (
      <Markdown fontSize={14} variant={'chat'}>
        {content}
      </Markdown>
    );
  },
);

CommentContent.displayName = 'TopicCommentContent';

const CommentCard = memo<CommentCardProps>(
  ({
    comment,
    onDeleted,
    onMutated,
    onOpenThread,
    pending,
    replyCount,
    replyStyle,
    rootReplyCount,
  }) => {
    const { t } = useTranslation('chat');

    const { text: time, title: timeTitle } = useActivityTime(comment.createdAt);
    const { mutatingIds, remove, restore, update } = useTopicCommentMutations();
    const [editing, setEditing] = useState(false);
    const [nextContent, setNextContent] = useState(comment.content);
    const [nextEditorData, setNextEditorData] = useState(comment.editorData);
    const editorRef = useRef<TopicCommentEditorRef>(null);
    const mutating = mutatingIds.has(comment.id);
    const deleted = Boolean(comment.deletedAt);
    const moderated = Boolean(comment.moderatedAt);
    const authorName =
      comment.author.fullName || comment.author.username || t('topicComment.author.deactivated');
    const edited = new Date(comment.updatedAt).getTime() > new Date(comment.createdAt).getTime();

    const handleUpdate = useCallback(async () => {
      const editorValue: TopicCommentEditorValue = editorRef.current?.getValue() ?? {
        content: nextContent,
        editorData: nextEditorData ?? null,
      };
      const input = createTopicCommentUpdateInput(comment.id, editorValue);
      if (!input.content || mutating) return;
      setNextContent(editorValue.content);
      setNextEditorData(editorValue.editorData);
      try {
        setEditing(false);
        await update(input, comment);
        onMutated?.();
      } catch {
        setEditing(true);
        toast.error(t('topicComment.updateFailed'));
      }
    }, [comment, mutating, nextContent, nextEditorData, onMutated, t, update]);

    const handleDelete = useCallback(() => {
      confirmModal({
        content: t('topicComment.deleteConfirm.content'),
        okButtonProps: { danger: true },
        okText: t('topicComment.delete'),
        onOk: () => {
          void remove(comment, replyCount ? 'soft' : 'hard', { rootReplyCount })
            .then((result) => {
              onDeleted?.(result.mode);
              onMutated?.();
            })
            .catch(() => {
              toast.error(t('topicComment.deleteFailed'));
            });
        },
        title: t('topicComment.deleteConfirm.title'),
      });
    }, [comment, onDeleted, onMutated, remove, replyCount, rootReplyCount, t]);

    const handleRestore = useCallback(async () => {
      try {
        await restore(comment, { rootReplyCount: replyCount });
        onMutated?.();
      } catch {
        toast.error(t('topicComment.restoreFailed'));
      }
    }, [comment, onMutated, replyCount, restore, t]);

    const menuItems = useMemo<DropdownItem[]>(() => {
      const items: DropdownItem[] = [];
      if (comment.canEdit) {
        items.push({
          icon: <Icon icon={Pencil} />,
          key: 'edit',
          label: t('topicComment.edit'),
          onClick: () => {
            setNextContent(comment.content);
            setNextEditorData(comment.editorData);
            setEditing(true);
          },
        });
      }
      if (comment.canDelete) {
        items.push({
          danger: true,
          icon: <Icon icon={Trash} />,
          key: 'delete',
          label: t('topicComment.delete'),
          onClick: handleDelete,
        });
      }
      return items;
    }, [comment.canDelete, comment.canEdit, comment.content, comment.editorData, handleDelete, t]);

    return (
      <Flexbox
        className={`${styles.card} ${replyStyle ? styles.reply : ''}`}
        data-topic-comment-id={comment.id}
        gap={8}
      >
        <Flexbox horizontal align={'center'} gap={8}>
          <Avatar avatar={comment.author.avatar || authorName} size={24} />
          <Text fontSize={13} weight={500}>
            {authorName}
          </Text>
          {comment.author.status === 'former' && (
            <Text fontSize={12} type={'secondary'}>
              {t('topicComment.author.former')}
            </Text>
          )}
          {pending ? (
            <Text fontSize={12} type={'secondary'}>
              {t('topicComment.sending')}
            </Text>
          ) : (
            time && (
              <Text fontSize={12} title={timeTitle} type={'secondary'}>
                {time}
              </Text>
            )
          )}
          {edited && !deleted && (
            <Text className={styles.edited} fontSize={12}>
              {t('topicComment.edited')}
            </Text>
          )}
        </Flexbox>

        <AnchorPreview comment={comment} />

        {deleted ? (
          <Text className={styles.deleted}>{t('topicComment.deleted')}</Text>
        ) : moderated ? (
          <Flexbox gap={8}>
            <Text className={styles.deleted}>
              {comment.moderationIsOwn
                ? t('topicComment.removedOwn')
                : comment.canRestore
                  ? t('topicComment.removedOwnerView')
                  : t('topicComment.removed')}
            </Text>
            {comment.canRestore && comment.content && (
              <div className={styles.moderatedContent}>
                <CommentContent content={comment.content} editorData={comment.editorData} />
              </div>
            )}
            {comment.canRestore && comment.moderationExpiresAt && (
              <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
                <Text fontSize={12} type={'secondary'}>
                  {t('topicComment.restoreDeadline', {
                    date: new Date(comment.moderationExpiresAt).toLocaleString(),
                  })}
                </Text>
                <Button loading={mutating} size={'small'} onClick={handleRestore}>
                  {t('topicComment.restore')}
                </Button>
              </Flexbox>
            )}
          </Flexbox>
        ) : editing ? (
          <Flexbox gap={8}>
            <div className={styles.editEditor}>
              <TopicCommentEditor
                autoFocus
                disabled={mutating}
                initialContent={nextContent}
                initialEditorData={nextEditorData}
                placeholder={t('topicComment.placeholder')}
                ref={editorRef}
                onChange={({ content, editorData }) => {
                  setNextContent(content);
                  setNextEditorData(editorData);
                }}
              />
            </div>
            <Flexbox horizontal gap={8} justify={'flex-end'}>
              <Button disabled={mutating} size={'small'} onClick={() => setEditing(false)}>
                {t('topicComment.cancel')}
              </Button>
              <Button loading={mutating} size={'small'} type={'primary'} onClick={handleUpdate}>
                {t('topicComment.save')}
              </Button>
            </Flexbox>
          </Flexbox>
        ) : (
          <CommentContent content={comment.content} editorData={comment.editorData} />
        )}

        {onOpenThread && (
          <Flexbox horizontal justify={'flex-end'}>
            <Button
              icon={<Icon icon={MessageCircle} />}
              size={'small'}
              type={'text'}
              onClick={onOpenThread}
            >
              {replyCount
                ? t('topicComment.replies', { count: replyCount })
                : t('topicComment.reply')}
            </Button>
          </Flexbox>
        )}

        {!editing && menuItems.length > 0 && (
          <div className={`${styles.cardActions} topic-comment-actions`}>
            <DropdownMenu items={menuItems}>
              <ActionIcon icon={MoreHorizontal} loading={mutating} size={'small'} />
            </DropdownMenu>
          </div>
        )}
      </Flexbox>
    );
  },
);

CommentCard.displayName = 'TopicCommentCard';

export default CommentCard;

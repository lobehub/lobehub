import type { TaskDetailActivity } from '@lobechat/types';
import { Editor, useEditor } from '@lobehub/editor/react';
import {
  ActionIcon,
  Avatar,
  Block,
  Button,
  type DropdownItem,
  DropdownMenu,
  Flexbox,
  Icon,
  Markdown,
  Text,
} from '@lobehub/ui';
import { App } from 'antd';
import { cssVar } from 'antd-style';
import dayjs from 'dayjs';
import { MessageCircle, MoreHorizontal, Pencil, Trash } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useTaskStore } from '@/store/task';

import { styles } from '../shared/style';

interface CommentCardProps {
  activity: TaskDetailActivity;
}

const CommentCard = memo<CommentCardProps>(({ activity }) => {
  const { t } = useTranslation('chat');
  const { modal } = App.useApp();
  const deleteComment = useTaskStore((s) => s.deleteComment);
  const updateComment = useTaskStore((s) => s.updateComment);

  const [isEditing, setIsEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const editor = useEditor();

  const relTime = activity.time ? dayjs(activity.time).fromNow() : '';
  const content = activity.content || t('taskDetail.activities.fallback.comment');
  const commentId = activity.id;

  const handleEdit = useCallback(() => {
    setIsEditing(true);
  }, []);

  const handleCancel = useCallback(() => {
    setIsEditing(false);
  }, []);

  const handleSave = useCallback(async () => {
    if (!commentId) return;
    const next = String(editor?.getDocument?.('markdown') ?? '').trim();
    if (!next || submitting) return;
    setSubmitting(true);
    try {
      await updateComment(commentId, next);
      setIsEditing(false);
    } finally {
      setSubmitting(false);
    }
  }, [commentId, editor, submitting, updateComment]);

  const handleDelete = useCallback(() => {
    if (!commentId) return;
    modal.confirm({
      centered: true,
      content: t('taskDetail.comment.deleteConfirm.content'),
      okButtonProps: { danger: true },
      okText: t('taskDetail.comment.deleteConfirm.ok'),
      onOk: () => deleteComment(commentId),
      title: t('taskDetail.comment.deleteConfirm.title'),
      type: 'error',
    });
  }, [commentId, deleteComment, modal, t]);

  const menuItems = useMemo<DropdownItem[]>(
    () => [
      {
        icon: <Icon icon={Pencil} />,
        key: 'edit',
        label: t('taskDetail.comment.edit'),
        onClick: handleEdit,
      },
      {
        danger: true,
        icon: <Icon icon={Trash} />,
        key: 'delete',
        label: t('taskDetail.comment.delete'),
        onClick: handleDelete,
      },
    ],
    [t, handleEdit, handleDelete],
  );

  return (
    <Block
      className={styles.commentCard}
      gap={8}
      padding={12}
      style={{ borderRadius: cssVar.borderRadiusLG }}
      variant={'outlined'}
    >
      <Flexbox horizontal align={'center'} gap={8}>
        {activity.author?.avatar ? (
          <Avatar avatar={activity.author.avatar} size={24} />
        ) : (
          <div className={styles.activityAvatar}>
            <MessageCircle size={12} />
          </div>
        )}
        <Text weight={500}>
          {activity.author?.name || t('taskDetail.activities.fallback.comment')}
        </Text>
        {relTime && (
          <Text fontSize={12} type={'secondary'}>
            {relTime}
          </Text>
        )}
      </Flexbox>

      {isEditing ? (
        <>
          <Editor
            content={content}
            editor={editor}
            enablePasteMarkdown={false}
            markdownOption={false}
            type={'text'}
            variant={'chat'}
          />
          <Flexbox horizontal gap={8} justify={'flex-end'}>
            <Button disabled={submitting} size={'small'} onClick={handleCancel}>
              {t('taskDetail.comment.cancel')}
            </Button>
            <Button loading={submitting} size={'small'} type={'primary'} onClick={handleSave}>
              {t('taskDetail.comment.save')}
            </Button>
          </Flexbox>
        </>
      ) : (
        <Markdown fontSize={14} variant={'chat'}>
          {content}
        </Markdown>
      )}

      {!isEditing && commentId && (
        <div className={`${styles.commentActions} comment-actions`}>
          <DropdownMenu items={menuItems}>
            <ActionIcon icon={MoreHorizontal} size={'small'} />
          </DropdownMenu>
        </div>
      )}
    </Block>
  );
});

export default CommentCard;

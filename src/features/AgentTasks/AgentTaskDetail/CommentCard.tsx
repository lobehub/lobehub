import type { TaskDetailActivity } from '@lobechat/types';
import { useEditor } from '@lobehub/editor/react';
import { LexicalRenderer } from '@lobehub/editor/renderer';
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
import { MessageCircle, MoreHorizontal, Pencil, Trash } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AttachmentUploadButton } from '@/features/AttachmentInput';
import { EditorCanvas } from '@/features/EditorCanvas';
import { seedAttachments } from '@/features/EditorCanvas/attachmentRegistry';
import {
  getAttachmentFileIdsFromEditor,
  insertFilesIntoEditor,
} from '@/features/EditorCanvas/editorAttachments';
import { LinearFileCard } from '@/features/EditorCanvas/LinearFilePlugin';
import { useActivityTime } from '@/hooks/useActivityTime';
import { useTaskStore } from '@/store/task';

import { styles } from '../shared/style';

// Keep saved comments visually consistent with the editor: render FileNodes
// as the Linear-style card on its own row instead of the default inline pill.
const FILE_WRAPPER_STYLE = { marginBlock: 8 };
const rendererOverrides = {
  file: (node: Record<string, any>) => (
    <div style={FILE_WRAPPER_STYLE}>
      <LinearFileCard node={node as Parameters<typeof LinearFileCard>[0]['node']} />
    </div>
  ),
};

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

  const { text: relTime, title: relTimeTitle } = useActivityTime(activity.time);
  const content = activity.content || t('taskDetail.activities.fallback.comment');
  const commentId = activity.id;

  const editorData = useMemo(
    () => ({
      content: activity.content ?? '',
      editorData: activity.editorData,
    }),
    [activity.content, activity.editorData],
  );

  const handleEdit = useCallback(() => {
    // Seed URL→fileId map so attachments serialize back to fileIds on save.
    if (activity.files && activity.files.length > 0) {
      seedAttachments(activity.files.map((f) => ({ id: f.id, url: f.url })));
    }
    setIsEditing(true);
  }, [activity.files]);

  const handleCancel = useCallback(() => {
    setIsEditing(false);
  }, []);

  const handleAttach = useCallback(
    (files: File[]) => {
      insertFilesIntoEditor(editor, files);
    },
    [editor],
  );

  const handleSave = useCallback(async () => {
    if (!commentId || submitting) return;
    const next = String(editor?.getDocument?.('markdown') ?? '').trim();
    const json = editor?.getDocument?.('json') as unknown;
    const hasFiles = getAttachmentFileIdsFromEditor(editor).length > 0;
    if (!next && !hasFiles) return;
    setSubmitting(true);
    try {
      await updateComment(commentId, next, { editorData: json });
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
      paddingBlock={12}
      paddingInline={8}
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
          <Text fontSize={12} title={relTimeTitle} type={'secondary'}>
            {relTime}
          </Text>
        )}
      </Flexbox>

      {isEditing && (
        <>
          <EditorCanvas
            editor={editor}
            editorData={editorData}
            entityId={commentId}
            floatingToolbar={false}
            style={{ paddingBottom: 4 }}
          />
          <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
            <AttachmentUploadButton onFiles={handleAttach} />
            <Flexbox horizontal gap={8}>
              <Button disabled={submitting} size={'small'} onClick={handleCancel}>
                {t('taskDetail.comment.cancel')}
              </Button>
              <Button loading={submitting} size={'small'} type={'primary'} onClick={handleSave}>
                {t('taskDetail.comment.save')}
              </Button>
            </Flexbox>
          </Flexbox>
        </>
      )}
      {!isEditing && Boolean(activity.editorData) && (
        <LexicalRenderer
          overrides={rendererOverrides}
          value={activity.editorData as Parameters<typeof LexicalRenderer>[0]['value']}
          variant={'chat'}
        />
      )}
      {!isEditing && !activity.editorData && (
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

import type { TaskDetailActivity } from '@lobechat/types';
import { useEditor } from '@lobehub/editor/react';
import { LexicalRenderer } from '@lobehub/editor/renderer';
import {
  ActionIcon,
  Avatar,
  Button,
  confirmModal,
  type DropdownItem,
  DropdownMenu,
  Flexbox,
  Icon,
  Markdown,
  Text,
} from '@lobehub/ui';
import { MessageCircle, MoreHorizontal, Pencil, Reply, Trash } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AttachmentUploadButton } from '@/features/AttachmentInput';
import { mentionPlainClassName } from '@/features/ChatInput/InputEditor/mentionStyle';
import { richTextImageRenderers } from '@/features/Conversation/Messages/User/components/richTextImageRenderers';
import { EditorCanvas } from '@/features/EditorCanvas';
import { seedAttachments } from '@/features/EditorCanvas/attachmentRegistry';
import {
  getAttachmentFileIdsFromEditor,
  hasIncompleteEditorAttachments,
  insertFilesIntoEditor,
} from '@/features/EditorCanvas/editorAttachments';
import { LinearFileCard } from '@/features/EditorCanvas/LinearFilePlugin';
import { useWorkspaceCommentMentionOption } from '@/features/Portal/TopicComments/useWorkspaceCommentMentionOption';
import { useActivityTime } from '@/hooks/useActivityTime';
import { useTaskStore } from '@/store/task';
import { isOptimisticActivityId } from '@/store/task/slices/detail/optimisticActivity';

import { styles } from '../shared/style';
import ActivityAuthorProfile from './ActivityAuthorProfile';
import { commentMarkdownProps } from './commentMarkdown';
import { resolveMarkdownSnapshotContent } from './commentRenderSource';

// Keep saved comments visually consistent with the editor: render FileNodes
// as the Linear-style card on its own row instead of the default inline pill.
const FILE_WRAPPER_STYLE = { marginBlock: 8 };
const rendererOverrides = {
  ...richTextImageRenderers,
  file: (node: Record<string, any>) => (
    <div style={FILE_WRAPPER_STYLE}>
      <LinearFileCard node={node as Parameters<typeof LinearFileCard>[0]['node']} />
    </div>
  ),
};

interface CommentItemProps {
  activity: TaskDetailActivity;
  /** A reply inside a thread: a smaller head, and no reply action of its own. */
  isReply?: boolean;
  /** Open the reply box of this comment's thread. Absent on replies. */
  onReply?: () => void;
  /** Replies under this comment; deleting it deletes them too, so the confirm says so. */
  replyCount?: number;
}

/**
 * One comment — a thread's top-level comment or one of its replies — with its
 * own edit / delete actions. The thread around it is `CommentCard`.
 */
const CommentItem = memo<CommentItemProps>(({ activity, isReply, onReply, replyCount = 0 }) => {
  const { t } = useTranslation('chat');
  const deleteComment = useTaskStore((s) => s.deleteComment);
  const updateComment = useTaskStore((s) => s.updateComment);

  const [isEditing, setIsEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingAttachments, setUploadingAttachments] = useState(false);
  const editor = useEditor();
  const mentionOption = useWorkspaceCommentMentionOption();

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
  const snapshotMarkdown = useMemo(
    () =>
      resolveMarkdownSnapshotContent({
        content: activity.content,
        editorData: activity.editorData,
      }),
    [activity.content, activity.editorData],
  );
  const renderSnapshot = Boolean(activity.editorData) && snapshotMarkdown === undefined;

  useEffect(() => {
    if (activity.files && activity.files.length > 0) {
      seedAttachments(
        activity.files.map((f) => ({ downloadUrl: f.downloadUrl, id: f.id, url: f.url })),
      );
    }
  }, [activity.files]);

  const handleEdit = useCallback(() => {
    setUploadingAttachments(false);
    setIsEditing(true);
  }, []);

  const handleEditorChange = useCallback(() => {
    setUploadingAttachments(hasIncompleteEditorAttachments(editor));
  }, [editor]);

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
    // A still-uploading image would be saved as its local `blob:` preview URL.
    if (!commentId || submitting || hasIncompleteEditorAttachments(editor)) return;
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
    confirmModal({
      content:
        replyCount > 0
          ? t('taskDetail.comment.deleteConfirm.threadContent', { count: replyCount })
          : t('taskDetail.comment.deleteConfirm.content'),
      okButtonProps: { danger: true },
      okText: t('taskDetail.comment.deleteConfirm.ok'),
      onOk: () => deleteComment(commentId),
      title: t('taskDetail.comment.deleteConfirm.title'),
    });
  }, [commentId, deleteComment, replyCount, t]);

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

  const avatarSize = isReply ? 20 : 24;
  const isPersisted = Boolean(commentId) && !isOptimisticActivityId(commentId);

  return (
    <Flexbox className={styles.commentCard} gap={8}>
      <Flexbox horizontal align={'center'} gap={8}>
        {activity.author?.avatar ? (
          <ActivityAuthorProfile author={activity.author}>
            <Avatar avatar={activity.author.avatar} size={avatarSize} />
          </ActivityAuthorProfile>
        ) : (
          <div className={styles.activityAvatar} style={{ height: avatarSize, width: avatarSize }}>
            <MessageCircle size={12} />
          </div>
        )}
        <Text weight={500}>
          <ActivityAuthorProfile author={activity.author}>
            {activity.author?.name || t('taskDetail.activities.fallback.comment')}
          </ActivityAuthorProfile>
        </Text>
        {relTime && (
          <Text fontSize={12} title={relTimeTitle} type={'secondary'}>
            {relTime}
          </Text>
        )}
      </Flexbox>

      {isEditing && (
        <>
          <div className={mentionPlainClassName}>
            <EditorCanvas
              editor={editor}
              editorData={editorData}
              entityId={commentId}
              floatingToolbar={false}
              mentionOption={mentionOption}
              style={{ paddingBottom: 4 }}
              onContentChange={handleEditorChange}
            />
          </div>
          <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
            <AttachmentUploadButton onFiles={handleAttach} />
            <Flexbox horizontal gap={8}>
              <Button disabled={submitting} size={'small'} onClick={handleCancel}>
                {t('taskDetail.comment.cancel')}
              </Button>
              <Button
                disabled={uploadingAttachments}
                loading={submitting}
                size={'small'}
                type={'primary'}
                onClick={handleSave}
              >
                {t('taskDetail.comment.save')}
              </Button>
            </Flexbox>
          </Flexbox>
        </>
      )}
      {!isEditing && renderSnapshot && (
        <LexicalRenderer
          className={mentionPlainClassName}
          overrides={rendererOverrides}
          value={activity.editorData as Parameters<typeof LexicalRenderer>[0]['value']}
          variant={'chat'}
        />
      )}
      {!isEditing && !renderSnapshot && (
        <Markdown fontSize={14} variant={'chat'} {...commentMarkdownProps}>
          {snapshotMarkdown ?? content}
        </Markdown>
      )}

      {!isEditing && isPersisted && (
        <Flexbox horizontal className={`${styles.commentActions} comment-actions`} gap={2}>
          {onReply && (
            <ActionIcon
              icon={Reply}
              size={'small'}
              title={t('taskDetail.comment.reply')}
              onClick={onReply}
            />
          )}
          <DropdownMenu items={menuItems}>
            <ActionIcon icon={MoreHorizontal} size={'small'} />
          </DropdownMenu>
        </Flexbox>
      )}
    </Flexbox>
  );
});

CommentItem.displayName = 'TaskCommentItem';

export default CommentItem;

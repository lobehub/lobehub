import type { TaskDetailActivity } from '@lobechat/types';
import { useEditor } from '@lobehub/editor/react';
import { LexicalRenderer, type NodeRenderer } from '@lobehub/editor/renderer';
import {
  ActionIcon,
  Button,
  confirmModal,
  DropdownMenu,
  Flexbox,
  Icon,
  Markdown,
  Tag,
  Text,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { MessageCircle, MoreHorizontal, Pencil, Reply, Trash } from 'lucide-react';
import { isValidElement, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Avatar from '@/components/Avatar';
import CollapsibleContent from '@/components/CollapsibleContent';
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
import { useActivityTime } from '@/hooks/useActivityTime';
import { usePermission } from '@/hooks/usePermission';
import { useTaskStore } from '@/store/task';
import { isOptimisticActivityId } from '@/store/task/slices/detail/optimisticActivity';

import ActivityAuthorProfile from './ActivityAuthorProfile';
import { commentMarkdownProps } from './commentMarkdown';
import { resolveMarkdownSnapshotContent, restoreEscapedNewlines } from './commentRenderSource';
import { useTaskCommentMentionOption } from './useTaskCommentMentionOption';

const styles = stylex.create({
  body: { minWidth: 0, overflowWrap: 'anywhere' },
  face: {
    backgroundColor: cssVar.colorBgContainer,
    borderRadius: '50%',
    display: 'flex',
    flexShrink: 0,
    position: 'relative',
    zIndex: 1,
  },
  fallback: {
    alignItems: 'center',
    backgroundColor: cssVar.colorFillTertiary,
    borderRadius: '50%',
    color: cssVar.colorTextQuaternary,
    display: 'flex',
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  header: { flexWrap: 'wrap', minHeight: 24, minWidth: 0 },
});

const rendererOverrides: Record<string, NodeRenderer> = {
  ...richTextImageRenderers,
  paragraph: (node, key, children) => {
    // exportJSON() omits children here; use the renderer's actual flow-content children.
    const Paragraph = children?.some(
      (child) => isValidElement(child) && (child.type === 'div' || child.type === 'figure'),
    )
      ? 'div'
      : 'p';
    return (
      <Paragraph key={key} style={node.format ? { textAlign: node.format } : undefined}>
        {children}
      </Paragraph>
    );
  },
  // Lexical exposes serialized nodes as records; this slot only receives file nodes.
  file: (node, key) => (
    <div key={key} style={{ marginBlock: 8 }}>
      <LinearFileCard node={node as unknown as Parameters<typeof LinearFileCard>[0]['node']} />
    </div>
  ),
};

interface CommentItemProps {
  activity: TaskDetailActivity;
  /** Root deletion removes its replies; reply deletion removes only that reply. */
  hasReplies?: boolean;
  onReply?: (activity: TaskDetailActivity) => void;
  readOnly?: boolean;
  taskId?: string;
}

/** Shared comment body and actions, with no timeline rail of its own. */
export const CommentItem = ({
  activity,
  hasReplies,
  onReply,
  readOnly,
  taskId,
}: CommentItemProps) => {
  const { t } = useTranslation('chat');
  const { allowed: canEditTask } = usePermission('create_content');
  const deleteComment = useTaskStore((s) => s.deleteComment);
  const updateComment = useTaskStore((s) => s.updateComment);
  const [isEditing, setIsEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingAttachments, setUploadingAttachments] = useState(false);
  const editor = useEditor();
  const mentionOption = useTaskCommentMentionOption();
  const { text: relTime, title: relTimeTitle } = useActivityTime(activity.time);
  const content = activity.content || t('taskDetail.activities.fallback.comment');
  const commentId = activity.id;
  const editorData = useMemo(
    () => ({ content: activity.content ?? '', editorData: activity.editorData }),
    [activity.content, activity.editorData],
  );
  const snapshotMarkdown = useMemo(
    () =>
      restoreEscapedNewlines(activity.content) ??
      resolveMarkdownSnapshotContent({
        content: activity.content,
        editorData: activity.editorData,
      }),
    [activity.content, activity.editorData],
  );
  const renderSnapshot = Boolean(activity.editorData) && snapshotMarkdown === undefined;

  useEffect(() => {
    if (activity.files?.length) {
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
  const handleAttach = useCallback(
    (files: File[]) => {
      insertFilesIntoEditor(editor, files);
    },
    [editor],
  );
  const handleSave = useCallback(async () => {
    if (!commentId || submitting || hasIncompleteEditorAttachments(editor)) return;
    const next = String(editor?.getDocument?.('markdown') ?? '').trim();
    const json = editor?.getDocument?.('json') as unknown;
    if (!next && !getAttachmentFileIdsFromEditor(editor).length) return;
    setSubmitting(true);
    try {
      await updateComment(commentId, next, { editorData: json, taskId });
      setIsEditing(false);
    } finally {
      setSubmitting(false);
    }
  }, [commentId, editor, submitting, taskId, updateComment]);
  const handleDelete = useCallback(() => {
    if (!commentId) return;
    confirmModal({
      content: t(
        hasReplies
          ? 'taskDetail.comment.thread.deleteConfirm.content'
          : 'taskDetail.comment.deleteConfirm.content',
      ),
      okButtonProps: { danger: true },
      okText: t('taskDetail.comment.deleteConfirm.ok'),
      onOk: () => deleteComment(commentId, taskId),
      title: t(
        hasReplies
          ? 'taskDetail.comment.thread.deleteConfirm.title'
          : 'taskDetail.comment.deleteConfirm.title',
      ),
    });
  }, [commentId, deleteComment, hasReplies, t, taskId]);

  const menuItems = [
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
  ];
  const isSaved = Boolean(commentId) && !isOptimisticActivityId(commentId);

  return (
    <Flexbox horizontal align={'flex-start'} gap={8}>
      <span {...stylex.props(styles.face)}>
        {activity.author?.avatar ? (
          <ActivityAuthorProfile author={activity.author}>
            <Avatar avatar={activity.author.avatar} size={24} />
          </ActivityAuthorProfile>
        ) : (
          <span {...stylex.props(styles.fallback)}>
            <MessageCircle size={12} />
          </span>
        )}
      </span>
      <Flexbox flex={1} gap={2} {...stylex.props(styles.body)}>
        <Flexbox horizontal align={'center'} gap={8} {...stylex.props(styles.header)}>
          <Text ellipsis style={{ flex: 'none', maxWidth: '50%' }} weight={500}>
            <ActivityAuthorProfile author={activity.author}>
              {activity.author?.name || t('taskDetail.activities.fallback.comment')}
            </ActivityAuthorProfile>
          </Text>
          {activity.author?.type === 'agent' && (
            <Tag size={'small'}>{t('taskDetail.comment.agentTag')}</Tag>
          )}
          {relTime && (
            <Text fontSize={12} title={relTimeTitle} type={'secondary'}>
              {relTime}
            </Text>
          )}
          <Flexbox flex={1} />
          {!isEditing && isSaved && !readOnly && canEditTask && (
            <Flexbox horizontal align={'center'} gap={2}>
              {onReply && (
                <Button
                  icon={<Icon icon={Reply} />}
                  size={'small'}
                  type={'text'}
                  onClick={() => onReply(activity)}
                >
                  {t('taskDetail.comment.reply')}
                </Button>
              )}
              <DropdownMenu items={menuItems}>
                <ActionIcon
                  icon={MoreHorizontal}
                  size={'small'}
                  title={t('taskDetail.comment.more')}
                />
              </DropdownMenu>
            </Flexbox>
          )}
        </Flexbox>
        {isEditing ? (
          <Flexbox gap={8}>
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
                <Button disabled={submitting} size={'small'} onClick={() => setIsEditing(false)}>
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
          </Flexbox>
        ) : (
          <CollapsibleContent maxHeight={160}>
            {renderSnapshot ? (
              <LexicalRenderer
                className={mentionPlainClassName}
                overrides={rendererOverrides}
                value={activity.editorData as Parameters<typeof LexicalRenderer>[0]['value']}
                variant={'chat'}
              />
            ) : (
              <Markdown fontSize={14} variant={'chat'} {...commentMarkdownProps}>
                {snapshotMarkdown ?? content}
              </Markdown>
            )}
          </CollapsibleContent>
        )}
      </Flexbox>
    </Flexbox>
  );
};

import type { DocumentCommentItem } from '@lobechat/types';
import { ChatInput, ChatInputActionBar, useEditor } from '@lobehub/editor/react';
import { ActionIcon, Avatar, Flexbox, Markdown, Text } from '@lobehub/ui';
import { Button, confirmModal, toast } from '@lobehub/ui/base-ui';
import { ChevronRight, MessageCircle, Pencil, Trash } from 'lucide-react';
import { memo, useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AttachmentMenu } from '@/features/AttachmentInput';
import RichTextMessage from '@/features/Conversation/Messages/User/components/RichTextMessage';
import { TypoBar } from '@/features/EditorCanvas';
import {
  getAttachmentFileIdsFromEditor,
  insertExistingAttachmentsIntoEditor,
  insertFilesIntoEditor,
} from '@/features/EditorCanvas/editorAttachments';
import { useActivityTime } from '@/hooks/useActivityTime';
import { useLocalStorageState } from '@/hooks/useLocalStorageState';
import { documentCommentService } from '@/services/documentComment';

import DocumentCommentEditor, {
  type DocumentCommentEditorRef,
  type DocumentCommentEditorValue,
} from './DocumentCommentEditor';
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

const hasDocumentCommentEditorData = (editorData: DocumentCommentItem['editorData']) =>
  Boolean(
    editorData &&
    typeof editorData === 'object' &&
    !Array.isArray(editorData) &&
    Object.keys(editorData).length > 0,
  );

const CommentContent = memo<Pick<DocumentCommentItem, 'content' | 'editorData'>>(
  ({ content, editorData }) =>
    hasDocumentCommentEditorData(editorData) ? (
      <RichTextMessage editorState={editorData} variant={'default'} />
    ) : (
      <Markdown fontSize={16} variant={'chat'}>
        {content}
      </Markdown>
    ),
);

CommentContent.displayName = 'DocumentCommentContent';

const CommentCard = memo<CommentCardProps>(
  ({ comment, onMutated, onReply, onUpdate, replying, variant = 'root' }) => {
    const { t } = useTranslation('file');
    const { text: time, title: timeTitle } = useActivityTime(comment.createdAt);
    const [editing, setEditing] = useState(false);
    const [content, setContent] = useState(comment.content);
    const [editorData, setEditorData] = useState(comment.editorData);
    const editEditor = useEditor();
    const editorRef = useRef<DocumentCommentEditorRef>(null);
    const editInputRef = useRef<HTMLDivElement>(null);
    const [hasAttachments, setHasAttachments] = useState(false);
    const [showTypoBar, setShowTypoBar] = useLocalStorageState(
      'document-comment:show-formatting-toolbar',
      false,
    );
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
      const editorValue: DocumentCommentEditorValue = editorRef.current?.getValue() ?? {
        content,
        editorData,
      };
      const nextContent = editorValue.content.trim();
      const hasFiles = getAttachmentFileIdsFromEditor(editEditor).length > 0;
      if ((!nextContent && !hasFiles) || mutating) return;
      setContent(nextContent);
      setEditorData(editorValue.editorData);
      setMutating(true);
      setEditing(false);
      try {
        await onUpdate(comment, { content: nextContent, editorData: editorValue.editorData });
      } catch {
        setEditing(true);
        toast.error(t('pageEditor.comments.updateFailed'));
      } finally {
        setMutating(false);
      }
    }, [comment, content, editEditor, editorData, mutating, onUpdate, t]);

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
      setEditorData(comment.editorData);
      setHasAttachments(false);
      setEditing(true);
    }, [comment.content, comment.editorData]);

    const handleAttach = useCallback(
      (files: File[]) => {
        insertFilesIntoEditor(editEditor, files);
      },
      [editEditor],
    );

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
            <ChatInput
              className={styles.editComposer}
              header={showTypoBar ? <TypoBar editor={editEditor} /> : undefined}
              minHeight={64}
              resize={false}
              slashMenuRef={editInputRef}
              footer={
                <ChatInputActionBar
                  style={{ paddingBlock: 4, paddingInline: 8 }}
                  left={
                    <AttachmentMenu
                      disabled={mutating}
                      formatEnabled={showTypoBar}
                      onFiles={handleAttach}
                      onFormatEnabledChange={setShowTypoBar}
                      onLibraryFiles={(attachments) =>
                        insertExistingAttachmentsIntoEditor(editEditor, attachments)
                      }
                    />
                  }
                  right={
                    <Flexbox horizontal gap={8}>
                      <Button disabled={mutating} size={'small'} onClick={() => setEditing(false)}>
                        {t('pageEditor.comments.cancel')}
                      </Button>
                      <Button
                        disabled={!content.trim() && !hasAttachments}
                        loading={mutating}
                        size={'small'}
                        type={'primary'}
                        onClick={handleUpdate}
                      >
                        {t('pageEditor.comments.save')}
                      </Button>
                    </Flexbox>
                  }
                />
              }
              onBodyClick={() => editEditor.focus()}
            >
              <DocumentCommentEditor
                autoFocus
                compact
                disabled={mutating}
                editor={editEditor}
                entityId={comment.id}
                getPopupContainer={() => editInputRef.current}
                initialContent={content}
                initialEditorData={editorData}
                placeholder={t('pageEditor.comments.placeholder')}
                ref={editorRef}
                onChange={({ content: nextContent, editorData: nextEditorData }) => {
                  setContent(nextContent);
                  setEditorData(nextEditorData);
                  setHasAttachments(getAttachmentFileIdsFromEditor(editEditor).length > 0);
                }}
              />
            </ChatInput>
          ) : (
            <CommentContent content={comment.content} editorData={comment.editorData} />
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

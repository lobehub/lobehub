import type { DocumentCommentItem } from '@lobechat/types';
import { ChatInput, ChatInputActionBar, useEditor } from '@lobehub/editor/react';
import { Flexbox, Markdown } from '@lobehub/ui';
import { ActionIcon, Avatar, Button, confirmModal, Text, toast } from '@lobehub/ui/base-ui';
import { cx } from 'antd-style';
import { ChevronRight, MessageCircle, Pencil, Trash } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AttachmentMenu } from '@/features/AttachmentInput';
import RichTextMessage from '@/features/Conversation/Messages/User/components/RichTextMessage';
import { TypoBar } from '@/features/EditorCanvas';
import {
  getEditorAttachmentStateFromJson,
  insertExistingAttachmentsIntoEditor,
  insertFilesIntoEditor,
} from '@/features/EditorCanvas/editorAttachments';
import { useActivityTime } from '@/hooks/useActivityTime';
import { useEnterToSend } from '@/hooks/useEnterToSend';
import { useLocalStorageState } from '@/hooks/useLocalStorageState';
import { documentCommentService } from '@/services/documentComment';

import AnchorQuote from './anchor/AnchorQuote';
import { useCommentAnchors } from './anchor/context';
import DocumentCommentEditor, {
  type DocumentCommentEditorRef,
  type DocumentCommentEditorValue,
} from './DocumentCommentEditor';
import type { DocumentCommentUpdateHandler } from './optimistic';
import { isOptimisticDocumentComment } from './optimistic';
import { COMMENT_INPUT_MAX_HEIGHT, styles } from './styles';

interface CommentCardProps {
  comment: DocumentCommentItem;
  /** Narrow-column layout for a card in the gutter: no avatar gutter, tighter spacing. */
  compact?: boolean;
  /** Whether a focus also scrolls the card into view. Defaults to true; a pick in the body passes false. */
  focusScroll?: boolean;
  /** Set when a deep link targets this comment; each new token highlights (and by default scrolls) again. */
  focusToken?: number;
  onMutated: () => void | Promise<void>;
  onReply?: () => void;
  onUpdate: DocumentCommentUpdateHandler;
  replying?: boolean;
  /**
   * Who a reply answers when it carries no explicit target — the thread's
   * root author. A flat (compact) list has no indentation to imply it, so
   * the card names the target itself.
   */
  threadAuthor?: DocumentCommentItem['author'];
  variant?: 'reply' | 'root';
}

const hasDocumentCommentEditorData = (editorData: DocumentCommentItem['editorData']) =>
  Boolean(
    editorData &&
    typeof editorData === 'object' &&
    !Array.isArray(editorData) &&
    Object.keys(editorData).length > 0,
  );

const CommentContent = memo<
  Pick<DocumentCommentItem, 'content' | 'editorData'> & { compact?: boolean }
>(({ compact, content, editorData }) => (
  <div className={styles.commentContent}>
    {hasDocumentCommentEditorData(editorData) ? (
      <RichTextMessage editorState={editorData} variant={'default'} />
    ) : (
      <Markdown fontSize={compact ? 14 : 16} variant={'chat'}>
        {content}
      </Markdown>
    )}
  </div>
));

CommentContent.displayName = 'DocumentCommentContent';

const CommentCard = memo<CommentCardProps>(
  ({
    comment,
    compact = false,
    focusScroll = true,
    focusToken,
    onMutated,
    onReply,
    onUpdate,
    replying,
    threadAuthor,
    variant = 'root',
  }) => {
    const { t } = useTranslation('file');
    const cardRef = useRef<HTMLDivElement>(null);
    const { text: time, title: timeTitle } = useActivityTime(comment.createdAt);
    const shouldSendOnEnter = useEnterToSend();
    const [editing, setEditing] = useState(false);
    const [content, setContent] = useState(comment.content);
    const [editorData, setEditorData] = useState(comment.editorData);
    const editEditor = useEditor();
    const editorRef = useRef<DocumentCommentEditorRef>(null);
    const editInputRef = useRef<HTMLDivElement>(null);
    const [showTypoBar, setShowTypoBar] = useLocalStorageState(
      'document-comment:show-formatting-toolbar',
      false,
    );
    const [mutating, setMutating] = useState(false);
    const { locateInBody, orphanedRootIds, setHoveredRootId } = useCommentAnchors();
    const anchor = comment.selectionAnchor;
    const anchorOrphaned = Boolean(anchor) && orphanedRootIds.has(comment.id);
    const deleted = Boolean(comment.deletedAt);
    const optimistic = isOptimisticDocumentComment(comment);
    const authorName =
      comment.author.fullName ||
      comment.author.username ||
      t('pageEditor.comments.author.deactivated');
    const replyTarget =
      comment.replyTo?.author ?? (compact && variant === 'reply' ? threadAuthor : undefined);
    const replyToName =
      replyTarget?.fullName ||
      replyTarget?.username ||
      (replyTarget ? t('pageEditor.comments.author.deactivated') : null);
    const edited = new Date(comment.updatedAt).getTime() > new Date(comment.createdAt).getTime();

    useEffect(() => {
      const node = cardRef.current;
      if (focusToken === undefined || !node) return;
      if (focusScroll) {
        // Honor reduced motion: jump instead of gliding; the steady highlight itself stays.
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        node.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
      }
      // Panel cards are placed level with their run instead of being tinted.
      if (compact) return;
      node.classList.add(styles.highlighted);
      const timer = setTimeout(() => node.classList.remove(styles.highlighted), 2400);
      return () => {
        clearTimeout(timer);
        node.classList.remove(styles.highlighted);
      };
    }, [compact, focusScroll, focusToken]);

    const handleUpdate = useCallback(async () => {
      const editorValue: DocumentCommentEditorValue = editorRef.current?.getValue() ?? {
        content,
        editorData,
      };
      const nextContent = editorValue.content.trim();
      const attachmentState = getEditorAttachmentStateFromJson(editorValue.editorData);
      if (
        attachmentState.hasIncompleteAttachments ||
        (!nextContent && !attachmentState.hasCompletedAttachments) ||
        mutating
      )
        return;
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
    }, [comment, content, editorData, mutating, onUpdate, t]);

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
      setEditing(true);
    }, [comment.content, comment.editorData]);

    const handleAttach = useCallback(
      (files: File[]) => {
        insertFilesIntoEditor(editEditor, files);
      },
      [editEditor],
    );
    const attachmentState = getEditorAttachmentStateFromJson(editorData);

    return (
      <Flexbox
        data-document-comment-id={comment.id}
        ref={cardRef}
        className={cx(
          styles.card,
          variant === 'reply' && styles.replyCard,
          compact && styles.cardCompact,
        )}
        onMouseEnter={anchor && !anchorOrphaned ? () => setHoveredRootId(comment.id) : undefined}
        onMouseLeave={
          anchor && !anchorOrphaned
            ? () => setHoveredRootId((current) => (current === comment.id ? null : current))
            : undefined
        }
      >
        {/* In the gutter the quote heads the card: it is what the card is about. */}
        {anchor && compact && (
          <AnchorQuote
            anchor={anchor}
            className={styles.cardAnchorCompact}
            orphaned={anchorOrphaned}
            onLocate={() => locateInBody(comment.id)}
          />
        )}
        <Flexbox
          horizontal
          align={compact ? 'flex-start' : 'center'}
          className={cx(styles.header, compact && styles.headerCompact)}
          gap={compact ? 8 : 8}
        >
          <Avatar
            avatar={comment.author.avatar || authorName}
            size={compact ? 28 : variant === 'reply' ? 28 : 32}
          />
          {compact ? (
            // Name over time, the way a card in a narrow column reads best.
            <Flexbox gap={2} style={{ minWidth: 0 }}>
              <Flexbox horizontal align={'center'} gap={6} style={{ minWidth: 0 }}>
                <Text ellipsis fontSize={13} weight={600}>
                  {authorName}
                </Text>
                {replyToName && (
                  <>
                    <ChevronRight aria-hidden className={styles.replyTargetIcon} size={12} />
                    <Text ellipsis fontSize={13} weight={600}>
                      {replyToName}
                    </Text>
                  </>
                )}
              </Flexbox>
              {time && (
                <Text className={styles.meta} fontSize={12} title={timeTitle}>
                  {time}
                  {edited && !deleted ? ` · ${t('pageEditor.comments.edited')}` : ''}
                  {comment.author.status === 'former'
                    ? ` · ${t('pageEditor.comments.author.former')}`
                    : ''}
                </Text>
              )}
            </Flexbox>
          ) : (
            <Text fontSize={14} weight={600}>
              {authorName}
            </Text>
          )}
          {!compact && replyToName && (
            <>
              <ChevronRight aria-hidden className={styles.replyTargetIcon} size={14} />
              <Text fontSize={14} weight={600}>
                {replyToName}
              </Text>
            </>
          )}
          {!compact && comment.author.status === 'former' && (
            <Text className={styles.meta} fontSize={12}>
              {t('pageEditor.comments.author.former')}
            </Text>
          )}
          {!compact && time && (
            <Text className={styles.meta} fontSize={14} title={timeTitle}>
              {time}
            </Text>
          )}
          {!compact && edited && !deleted && (
            <Text className={styles.meta} fontSize={12}>
              {t('pageEditor.comments.edited')}
            </Text>
          )}
        </Flexbox>

        {anchor && !compact && (
          <AnchorQuote
            anchor={anchor}
            className={styles.cardAnchor}
            orphaned={anchorOrphaned}
            onLocate={() => locateInBody(comment.id)}
          />
        )}

        <div
          className={cx(
            styles.body,
            variant === 'reply' && styles.replyBody,
            compact && styles.bodyCompact,
          )}
        >
          {deleted ? (
            <Text className={styles.deleted}>{t('pageEditor.comments.deleted')}</Text>
          ) : editing ? (
            <ChatInput
              className={styles.editComposer}
              header={showTypoBar ? <TypoBar editor={editEditor} /> : undefined}
              maxHeight={COMMENT_INPUT_MAX_HEIGHT}
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
                        loading={mutating}
                        size={'small'}
                        type={'primary'}
                        disabled={
                          attachmentState.hasIncompleteAttachments ||
                          (!content.trim() && !attachmentState.hasCompletedAttachments)
                        }
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
                }}
                onPressEnter={(event) => {
                  // Same interaction as the composer: Enter saves (per the
                  // global send preference), Shift+Enter inserts a newline.
                  if (!shouldSendOnEnter(event)) return;
                  void handleUpdate();
                  return true;
                }}
              />
            </ChatInput>
          ) : (
            <CommentContent
              compact={compact}
              content={comment.content}
              editorData={comment.editorData}
            />
          )}
        </div>

        {!optimistic && !editing && (onReply || comment.canEdit || comment.canDelete) && (
          <Flexbox
            horizontal
            gap={4}
            className={cx(
              styles.actions,
              variant === 'reply' && styles.replyCardActions,
              compact && styles.actionsCompact,
            )}
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

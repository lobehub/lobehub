import type { TaskDetailActivityAuthor } from '@lobechat/types';
import type { IEditor } from '@lobehub/editor';
import { SendButton, useEditor } from '@lobehub/editor/react';
import { ActionIcon, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { $createParagraphNode, $getRoot, $isParagraphNode } from 'lexical';
import { CornerDownRight, X } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Avatar from '@/components/Avatar';
import { AttachmentUploadButton } from '@/features/AttachmentInput';
import { mentionPlainClassName } from '@/features/ChatInput/InputEditor/mentionStyle';
import { EditorCanvas } from '@/features/EditorCanvas';
import {
  getAttachmentFileIdsFromEditor,
  hasIncompleteEditorAttachments,
  insertFilesIntoEditor,
} from '@/features/EditorCanvas/editorAttachments';
import { insertTopicCommentMention } from '@/features/Portal/TopicComments/editorUtils';
import { useEnterToSend } from '@/hooks/useEnterToSend';
import { usePermission } from '@/hooks/usePermission';
import { useUserAvatar } from '@/hooks/useUserAvatar';

import { useCommentSubmit } from './useCommentSubmit';
import { useTaskCommentMentionOption } from './useTaskCommentMentionOption';

export interface CommentReplyRequest {
  author?: TaskDetailActivityAuthor | null;
  nonce: number;
}

const styles = stylex.create({
  card: {
    backgroundColor: {
      'default': cssVar.colorFillTertiary,
      ':hover': cssVar.colorFillSecondary,
      ':focus-within': cssVar.colorFillTertiary,
    },
    borderColor: { 'default': 'transparent', ':focus-within': cssVar.colorBorder },
    borderRadius: cssVar.borderRadiusLG,
    borderStyle: 'solid',
    borderWidth: 1,
    minWidth: 0,
    paddingBlock: 4,
    paddingInline: 8,
  },
  threadCard: {
    backgroundColor: cssVar.colorBgContainer,
    borderColor: { 'default': cssVar.colorBorder, ':focus-within': cssVar.colorTextTertiary },
    borderRadius: cssVar.borderRadiusLG,
    borderStyle: 'solid',
    borderWidth: 1,
    minWidth: 0,
    paddingBlock: 8,
    paddingInline: 8,
  },
  row: { minWidth: 0, width: '100%' },
  target: { color: cssVar.colorTextSecondary, fontSize: 12 },
  error: { color: cssVar.colorError, fontSize: 12, marginBlockStart: 4 },
});

interface CommentInputProps {
  parentCommentId?: string;
  replyRequest?: CommentReplyRequest;
  taskId: string;
}

const CommentInput = memo<CommentInputProps>(({ parentCommentId, replyRequest, taskId }) => {
  const { t } = useTranslation('chat');
  const { allowed: canEditTask } = usePermission('create_content');
  const editor = useEditor();
  const userAvatar = useUserAvatar();
  const rootRef = useRef<HTMLDivElement>(null);
  const [hasContent, setHasContent] = useState(false);
  const [targetAuthor, setTargetAuthor] = useState<TaskDetailActivityAuthor | null>(null);
  const handledRequest = useRef<CommentReplyRequest | undefined>(undefined);
  const [hasAttachments, setHasAttachments] = useState(false);
  const [uploadingAttachments, setUploadingAttachments] = useState(false);
  const shouldSendOnEnter = useEnterToSend();
  const mentionOption = useTaskCommentMentionOption();

  // A still-uploading image would be sent as its local `blob:` preview URL.
  const canSubmit = (hasContent || hasAttachments) && !uploadingAttachments;

  const handleContentChange = useCallback(() => {
    const lexicalEditor = editor?.getLexicalEditor?.();
    if (!lexicalEditor) return;
    lexicalEditor.getEditorState().read(() => {
      const text = $getRoot().getTextContent().trim();
      setHasContent(text.length > 0);
    });
    setHasAttachments(getAttachmentFileIdsFromEditor(editor).length > 0);
    setUploadingAttachments(hasIncompleteEditorAttachments(editor));
  }, [editor]);

  const handleAttach = useCallback(
    (files: File[]) => {
      insertFilesIntoEditor(editor, files);
    },
    [editor],
  );

  const handleContentReset = useCallback(
    (state: { hasAttachments: boolean; hasContent: boolean }) => {
      setHasContent(state.hasContent);
      setHasAttachments(state.hasAttachments);
      setUploadingAttachments(hasIncompleteEditorAttachments(editor));
    },
    [editor],
  );

  const {
    sendFailed,
    submit: handleSubmit,
    submitting,
  } = useCommentSubmit({
    canComment: canEditTask,
    editor,
    onContentReset: handleContentReset,
    parentCommentId,
    taskId,
  });

  const applyReplyRequest = useCallback(
    (instance: IEditor) => {
      if (!replyRequest || handledRequest.current === replyRequest) return;
      const lexicalEditor = instance.getLexicalEditor?.();
      if (!lexicalEditor) return;
      handledRequest.current = replyRequest;
      setTargetAuthor(replyRequest.author ?? null);
      rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      lexicalEditor.update(
        () => {
          const root = $getRoot();
          const last = root.getLastChild();
          if ($isParagraphNode(last)) last.selectEnd();
          else {
            const paragraph = $createParagraphNode();
            root.append(paragraph);
            paragraph.selectEnd();
          }
        },
        { discrete: true },
      );
      const author = replyRequest.author;
      if (author?.id && !author.unresolved && author.name) {
        insertTopicCommentMention(instance, {
          key: `${author.type}-${author.id}`,
          label: author.name,
          metadata: { id: author.id, type: author.type === 'agent' ? 'agent' : 'member' },
        });
      } else instance.focus();
      handleContentChange();
    },
    [handleContentChange, replyRequest],
  );

  useEffect(() => {
    if (editor) applyReplyRequest(editor);
  }, [applyReplyRequest, editor]);

  const editorContent = (
    <div
      className={mentionPlainClassName}
      // The root composer is a row; a thread is a column, where a zero flex basis clips its editor.
      style={{ flex: parentCommentId ? 'none' : '1 1 0', minWidth: 0, overflow: 'hidden' }}
    >
      <EditorCanvas
        editor={editor}
        floatingToolbar={false}
        mentionOption={mentionOption}
        placeholder={t(
          parentCommentId
            ? 'taskDetail.comment.thread.placeholder'
            : 'taskDetail.commentPlaceholder',
        )}
        style={{
          fontSize: 14,
          maxWidth: '100%',
          minHeight: parentCommentId ? 64 : 24,
          overflow: 'hidden',
          paddingBlock: 0,
          whiteSpace: 'normal',
        }}
        onContentChange={handleContentChange}
        onInit={applyReplyRequest}
        onPressEnter={({ event }) => {
          if (!canEditTask) return true;
          if (shouldSendOnEnter(event)) {
            handleSubmit();
            return true;
          }
        }}
      />
    </div>
  );
  const controls = (
    <Flexbox
      horizontal
      align={'center'}
      gap={4}
      justify={parentCommentId ? 'space-between' : undefined}
      style={{ flexShrink: 0 }}
    >
      <AttachmentUploadButton onFiles={handleAttach} />
      <SendButton
        disabled={!canEditTask || (!canSubmit && !submitting)}
        loading={submitting}
        shape={'round'}
        type={'text'}
        onClick={handleSubmit}
      />
    </Flexbox>
  );

  return (
    <Flexbox ref={rootRef}>
      <Flexbox
        horizontal
        align={parentCommentId ? 'flex-start' : 'center'}
        gap={parentCommentId ? 12 : 8}
        {...stylex.props(styles.row, !parentCommentId && styles.card)}
      >
        <Avatar
          avatar={userAvatar}
          size={24}
          style={{ flexShrink: 0, marginBlockStart: parentCommentId ? 8 : 0 }}
        />
        {parentCommentId ? (
          <Flexbox flex={1} gap={6} {...stylex.props(styles.threadCard)}>
            {targetAuthor?.name && (
              <Flexbox horizontal align={'center'} gap={4} {...stylex.props(styles.target)}>
                <CornerDownRight size={13} />
                <Text fontSize={12}>
                  {t('taskDetail.comment.thread.replyTo', { name: targetAuthor.name })}
                </Text>
                <ActionIcon
                  icon={X}
                  size={'small'}
                  title={t('taskDetail.comment.thread.cancelTarget')}
                  onClick={() => {
                    setTargetAuthor(null);
                    editor?.focus();
                  }}
                />
              </Flexbox>
            )}
            {editorContent}
            {controls}
          </Flexbox>
        ) : (
          <>
            {editorContent}
            {controls}
          </>
        )}
      </Flexbox>
      {sendFailed && (
        <div role={'alert'} {...stylex.props(styles.error)}>
          {t('taskDetail.comment.sendError')}
        </div>
      )}
    </Flexbox>
  );
});

export default CommentInput;

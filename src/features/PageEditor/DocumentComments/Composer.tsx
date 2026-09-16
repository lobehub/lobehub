import type { DocumentCommentJson, DocumentCommentSelectionAnchor } from '@lobechat/types';
import { ChatInput, ChatInputActionBar, SendButton, useEditor } from '@lobehub/editor/react';
import { Flexbox } from '@lobehub/ui';
import { Avatar, toast } from '@lobehub/ui/base-ui';
import { nanoid } from 'nanoid';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { AttachmentMenu } from '@/features/AttachmentInput';
import { TypoBar } from '@/features/EditorCanvas';
import {
  getEditorAttachmentStateFromJson,
  insertExistingAttachmentsIntoEditor,
  insertFilesIntoEditor,
} from '@/features/EditorCanvas/editorAttachments';
import { useEnterToSend } from '@/hooks/useEnterToSend';
import { useLocalStorageState } from '@/hooks/useLocalStorageState';
import { usePermission } from '@/hooks/usePermission';
import { useUserAvatar } from '@/hooks/useUserAvatar';

import { usePageEditorStore } from '../store';
import AnchorQuote from './anchor/AnchorQuote';
import { DOCUMENT_COMMENT_COMPOSER_ID } from './anchor/constants';
import DocumentCommentEditor, { type DocumentCommentEditorRef } from './DocumentCommentEditor';
import type { DocumentCommentSubmitInput } from './optimistic';
import { COMMENT_INPUT_MAX_HEIGHT, styles } from './styles';

interface Draft {
  clientId: string;
  content: string;
  editorData: DocumentCommentJson | null;
  /**
   * Persisted alongside the text so a reload can't turn a comment the reader
   * started on a specific run into a comment about the whole document.
   */
  selectionAnchor?: DocumentCommentSelectionAnchor;
}

interface ComposerProps {
  documentId: string;
  onSubmit: (input: DocumentCommentSubmitInput) => Promise<void>;
  onSuccess?: () => void;
  parentCommentId?: string;
}

const Composer = memo<ComposerProps>(({ documentId, onSubmit, onSuccess, parentCommentId }) => {
  const { t } = useTranslation('file');
  const workspaceId = useActiveWorkspaceId();
  const { allowed: canCreate } = usePermission('create_content');
  const avatar = useUserAvatar();
  const shouldSendOnEnter = useEnterToSend();
  const editor = useEditor();
  const editorRef = useRef<DocumentCommentEditorRef>(null);
  const inputRef = useRef<HTMLDivElement>(null);
  const submittingRef = useRef(false);
  const [draft, setDraft] = useLocalStorageState<Draft>(
    `document-comment-draft:${workspaceId ?? 'personal'}:${documentId}:${parentCommentId ?? 'root'}`,
    { clientId: nanoid(), content: '', editorData: null },
  );
  // Only a root comment can be anchored; a reply shares its thread's anchor.
  const isRootComposer = !parentCommentId;
  // The store outlives a document switch, so a quote captured in another
  // document is not this composer's to adopt.
  const pendingAnchor = usePageEditorStore((s) =>
    s.pendingCommentAnchor?.documentId === documentId ? s.pendingCommentAnchor.anchor : undefined,
  );
  const setPendingCommentAnchor = usePageEditorStore((s) => s.setPendingCommentAnchor);
  const anchor = isRootComposer ? draft.selectionAnchor : undefined;
  const [showTypoBar, setShowTypoBar] = useLocalStorageState(
    'document-comment:show-formatting-toolbar',
    false,
  );
  const [submitting, setSubmitting] = useState(false);

  // Intake: the toolbar drops a freshly captured selection into the store and
  // the root composer adopts it as its draft anchor.
  useEffect(() => {
    if (!isRootComposer || !pendingAnchor) return;
    setDraft((current) =>
      current.selectionAnchor === pendingAnchor
        ? current
        : { ...current, selectionAnchor: pendingAnchor },
    );
  }, [isRootComposer, pendingAnchor, setDraft]);

  // Restore: the draft outlives a reload, the store doesn't, so republish the
  // draft's anchor to keep the body highlight in sync with what will be sent.
  useEffect(() => {
    if (!isRootComposer || !anchor || pendingAnchor) return;
    setPendingCommentAnchor({ anchor, documentId });
  }, [anchor, documentId, isRootComposer, pendingAnchor, setPendingCommentAnchor]);

  const clearAnchor = useCallback(() => {
    setDraft((current) => ({ ...current, selectionAnchor: undefined }));
    setPendingCommentAnchor(undefined);
  }, [setDraft, setPendingCommentAnchor]);

  const submit = useCallback(async () => {
    const editorValue = editorRef.current?.getValue() ?? {
      content: draft.content,
      editorData: draft.editorData,
    };
    const content = editorValue.content.trim();
    const attachmentState = getEditorAttachmentStateFromJson(editorValue.editorData);
    if (
      !workspaceId ||
      !canCreate ||
      attachmentState.hasIncompleteAttachments ||
      (!content && !attachmentState.hasCompletedAttachments) ||
      submittingRef.current
    )
      return;

    submittingRef.current = true;
    setSubmitting(true);
    const submittedDraft = { clientId: draft.clientId, ...editorValue, selectionAnchor: anchor };
    setDraft({ clientId: nanoid(), content: '', editorData: null });
    setPendingCommentAnchor(undefined);
    editorRef.current?.clean();
    try {
      await onSubmit({
        clientId: submittedDraft.clientId,
        content,
        editorData: editorValue.editorData,
        selectionAnchor: anchor,
      });
      onSuccess?.();
    } catch {
      setDraft((current) => (current.content ? current : submittedDraft));
      editorRef.current?.setValue(editorValue);
      editorRef.current?.focus();
      toast.error(t('pageEditor.comments.createFailed'));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }, [
    anchor,
    canCreate,
    draft,
    onSubmit,
    onSuccess,
    setDraft,
    setPendingCommentAnchor,
    t,
    workspaceId,
  ]);

  const handleAttach = useCallback(
    (files: File[]) => {
      insertFilesIntoEditor(editor, files);
    },
    [editor],
  );

  if (!workspaceId || !canCreate || (submitting && parentCommentId)) return null;

  const attachmentState = getEditorAttachmentStateFromJson(draft.editorData);

  return (
    <Flexbox
      horizontal
      align={'flex-start'}
      gap={12}
      id={isRootComposer ? DOCUMENT_COMMENT_COMPOSER_ID : undefined}
    >
      <Flexbox className={styles.composerAvatar}>
        <Avatar avatar={avatar} size={parentCommentId ? 28 : 32} />
      </Flexbox>
      <ChatInput
        className={styles.composer}
        flex={1}
        maxHeight={COMMENT_INPUT_MAX_HEIGHT}
        minHeight={72}
        resize={false}
        slashMenuRef={inputRef}
        footer={
          <ChatInputActionBar
            style={{ paddingBlock: 4, paddingInline: 8 }}
            left={
              <AttachmentMenu
                disabled={submitting}
                formatEnabled={showTypoBar}
                onFiles={handleAttach}
                onFormatEnabledChange={setShowTypoBar}
                onLibraryFiles={(attachments) =>
                  insertExistingAttachmentsIntoEditor(editor, attachments)
                }
              />
            }
            right={
              <SendButton
                loading={submitting}
                shape={'round'}
                type={'primary'}
                disabled={
                  attachmentState.hasIncompleteAttachments ||
                  (!draft.content.trim() && !attachmentState.hasCompletedAttachments)
                }
                title={
                  parentCommentId
                    ? t('pageEditor.comments.replyAction')
                    : t('pageEditor.comments.publish')
                }
                onClick={() => void submit()}
              />
            }
          />
        }
        header={
          anchor || showTypoBar ? (
            <>
              {anchor && (
                <AnchorQuote
                  anchor={anchor}
                  className={styles.composerAnchor}
                  onDismiss={clearAnchor}
                />
              )}
              {showTypoBar && <TypoBar editor={editor} />}
            </>
          ) : undefined
        }
        onBodyClick={() => editor.focus()}
      >
        <DocumentCommentEditor
          autoFocus={Boolean(parentCommentId)}
          disabled={submitting}
          editor={editor}
          entityId={draft.clientId}
          getPopupContainer={() => inputRef.current}
          initialContent={draft.content}
          initialEditorData={draft.editorData}
          ref={editorRef}
          placeholder={
            parentCommentId
              ? t('pageEditor.comments.replyPlaceholder')
              : t('pageEditor.comments.placeholder')
          }
          onChange={({ content, editorData }) => {
            setDraft((current) => ({ ...current, content, editorData }));
          }}
          onPressEnter={(event) => {
            if (!shouldSendOnEnter(event)) return;
            void submit();
            return true;
          }}
        />
      </ChatInput>
    </Flexbox>
  );
});

Composer.displayName = 'DocumentCommentComposer';

export default Composer;

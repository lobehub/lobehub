import type { DocumentCommentJson } from '@lobechat/types';
import { ChatInput, ChatInputActionBar, SendButton, useEditor } from '@lobehub/editor/react';
import { Flexbox } from '@lobehub/ui';
import { Avatar, toast } from '@lobehub/ui/base-ui';
import { nanoid } from 'nanoid';
import { memo, useCallback, useRef, useState } from 'react';
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

import DocumentCommentEditor, { type DocumentCommentEditorRef } from './DocumentCommentEditor';
import type { DocumentCommentSubmitInput } from './optimistic';
import { COMMENT_INPUT_MAX_HEIGHT, styles } from './styles';

interface Draft {
  clientId: string;
  content: string;
  editorData: DocumentCommentJson | null;
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
  const [showTypoBar, setShowTypoBar] = useLocalStorageState(
    'document-comment:show-formatting-toolbar',
    false,
  );
  const [submitting, setSubmitting] = useState(false);

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
    const submittedDraft = { clientId: draft.clientId, ...editorValue };
    setDraft({ clientId: nanoid(), content: '', editorData: null });
    editorRef.current?.clean();
    try {
      await onSubmit({
        clientId: submittedDraft.clientId,
        content,
        editorData: editorValue.editorData,
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
  }, [canCreate, draft, onSubmit, onSuccess, setDraft, t, workspaceId]);

  const handleAttach = useCallback(
    (files: File[]) => {
      insertFilesIntoEditor(editor, files);
    },
    [editor],
  );

  if (!workspaceId || !canCreate || (submitting && parentCommentId)) return null;

  const attachmentState = getEditorAttachmentStateFromJson(draft.editorData);

  return (
    <Flexbox horizontal align={'flex-start'} gap={12}>
      <Flexbox className={styles.composerAvatar}>
        <Avatar avatar={avatar} size={parentCommentId ? 28 : 32} />
      </Flexbox>
      <ChatInput
        className={styles.composer}
        flex={1}
        header={showTypoBar ? <TypoBar editor={editor} /> : undefined}
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

import { ChatInput, ChatInputActionBar, SendButton, useEditor } from '@lobehub/editor/react';
import { Button, Flexbox } from '@lobehub/ui';
import { $getRoot } from 'lexical';
import { ChevronDownIcon, MessageCirclePlus } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AttachmentUploadButton } from '@/features/AttachmentInput';
import { useConversationStore } from '@/features/Conversation';
import OpStatusTray from '@/features/Conversation/ChatInput/OpStatusTray';
import { EditorCanvas } from '@/features/EditorCanvas';
import {
  getAttachmentFileIdsFromEditor,
  insertFilesIntoEditor,
} from '@/features/EditorCanvas/editorAttachments';
import { useEnterToSend } from '@/hooks/useEnterToSend';

const FeedbackInput = memo(() => {
  const { t } = useTranslation('chat');
  const editor = useEditor();
  const sendMessage = useConversationStore((s) => s.sendMessage);
  const [submitting, setSubmitting] = useState(false);
  const [hasContent, setHasContent] = useState(false);
  const [hasAttachments, setHasAttachments] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const shouldSendOnEnter = useEnterToSend();

  const canSubmit = hasContent || hasAttachments;

  useEffect(() => {
    if (expanded) editor?.focus?.();
  }, [expanded, editor]);

  const handleContentChange = useCallback(() => {
    const lexicalEditor = editor?.getLexicalEditor?.();
    if (!lexicalEditor) return;
    lexicalEditor.getEditorState().read(() => {
      const text = $getRoot().getTextContent().trim();
      setHasContent(text.length > 0);
    });
    setHasAttachments(getAttachmentFileIdsFromEditor(editor).length > 0);
  }, [editor]);

  const handleAttach = useCallback(
    (files: File[]) => {
      insertFilesIntoEditor(editor, files);
    },
    [editor],
  );

  const handleSubmit = useCallback(async () => {
    if (submitting) return;
    const editorData = editor?.getDocument?.('json') as Record<string, any> | undefined;
    const markdown = String(editor?.getDocument?.('markdown') ?? '').trim();
    const hasFiles = getAttachmentFileIdsFromEditor(editor).length > 0;
    if (!markdown && !hasFiles) return;

    // Clear the editor synchronously BEFORE await so the input feels
    // responsive — sendMessage's optimistic-update pipeline keeps a copy
    // of the captured markdown / editorData for rendering. Keep the
    // ChatInput expanded after send: once the user has opened the reply
    // composer, treat it as the new resting state for this drawer session.
    editor?.cleanDocument?.();
    setHasContent(false);
    setHasAttachments(false);

    setSubmitting(true);
    try {
      // sendMessage is bound to this drawer's ConversationProvider context
      // (agentId + topicId + isolatedTopic), so the message continues this
      // topic's conversation. Files attached inline in the editor travel as
      // part of editorData / markdown — no separate files array needed.
      // Force the gateway runtime so the follow-up runs on the same
      // server-side path as the original `runTask` that spawned this topic,
      // regardless of the user's global local/cloud preference.
      await sendMessage({ editorData, forceRuntime: 'gateway', message: markdown });
    } finally {
      setSubmitting(false);
    }
  }, [editor, sendMessage, submitting]);

  // Mirror Fleet's ReplyArea: surface the live running-op status flush above the
  // reply affordance (seamless inline row that renders nothing when idle), so the
  // user can watch the agent work without expanding the composer.
  if (!expanded) {
    return (
      <Flexbox gap={8}>
        <OpStatusTray seamless />
        <Button block icon={MessageCirclePlus} variant={'filled'} onClick={() => setExpanded(true)}>
          {t('taskDetail.sendFollowUp')}
        </Button>
      </Flexbox>
    );
  }

  return (
    <Flexbox gap={8}>
      <OpStatusTray seamless />
      <ChatInput
        maxHeight={240}
        minHeight={64}
        footer={
          <ChatInputActionBar
            style={{ paddingInline: 8 }}
            left={
              <Flexbox horizontal align={'center'} gap={2}>
                <Button
                  icon={ChevronDownIcon}
                  size={'small'}
                  type={'text'}
                  onClick={() => setExpanded(false)}
                >
                  {t('taskDetail.collapseReply')}
                </Button>
                <AttachmentUploadButton onFiles={handleAttach} />
              </Flexbox>
            }
            right={
              <SendButton
                disabled={!canSubmit && !submitting}
                loading={submitting}
                shape={'round'}
                title={t('taskDetail.replyInThread')}
                type={'primary'}
                onClick={handleSubmit}
              />
            }
          />
        }
      >
        <EditorCanvas
          editor={editor}
          floatingToolbar={false}
          placeholder={t('taskDetail.replyPlaceholder')}
          style={{ paddingBlock: 0 }}
          onContentChange={handleContentChange}
          onPressEnter={({ event }) => {
            if (shouldSendOnEnter(event)) {
              handleSubmit();
              return true;
            }
          }}
        />
      </ChatInput>
    </Flexbox>
  );
});

FeedbackInput.displayName = 'FeedbackInput';

export default FeedbackInput;

import { ChatInput, ChatInputActionBar, SendButton, useEditor } from '@lobehub/editor/react';
import { Flexbox } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { $getRoot } from 'lexical';
import { ChevronDownIcon, MessageCirclePlus } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AttachmentUploadButton } from '@/features/AttachmentInput';
import OpStatusTray from '@/features/Conversation/ChatInput/OpStatusTray';
import { useConversationChatInputUiState } from '@/features/Conversation/ChatInput/useConversationChatInputUiState';
import { useConversationResourceAccess } from '@/features/Conversation/hooks/useConversationResourceAccess';
import { useConversationStore } from '@/features/Conversation/store';
import { EditorCanvas } from '@/features/EditorCanvas';
import {
  getAttachmentFileIdsFromEditor,
  insertFilesIntoEditor,
} from '@/features/EditorCanvas/editorAttachments';
import { useEnterToSend } from '@/hooks/useEnterToSend';

interface FeedbackInputProps {
  /** Acceptance's in-flow topic rail starts with the composer visible. The
      floating Topic drawer keeps its compact, opt-in default. */
  defaultExpanded?: boolean;
  /** Hide the collapse affordance when the hosting surface intentionally pins
      the composer open, as Acceptance's in-flow right rail does. */
  disableCollapse?: boolean;
}

const FeedbackInput = memo<FeedbackInputProps>(
  ({ defaultExpanded = false, disableCollapse = false }) => {
    const { t } = useTranslation('chat');
    const editor = useEditor();
    const sendMessage = useConversationStore((s) => s.sendMessage);
    const stopGenerating = useConversationStore((s) => s.stopGenerating);
    const [submitting, setSubmitting] = useState(false);
    const [hasContent, setHasContent] = useState(false);
    const [hasAttachments, setHasAttachments] = useState(false);
    const [expanded, setExpanded] = useState(defaultExpanded);
    const shouldSendOnEnter = useEnterToSend();
    // Task follow-ups send into the shared agent's topic — view-only members
    // can watch the run but get no reply composer.
    const { canUseResource } = useConversationResourceAccess();

    const canSubmit = hasContent || hasAttachments;
    // The run this drawer shows is a real op in its own conversation context, so
    // the composer reads the same op-derived send area as the main composer:
    // while the agent is working the control is Stop, and a typed follow-up
    // queues beside it instead of reading as a fresh send. Without it the drawer
    // offered Send during a running run — no way to stop it, and no sign that the
    // follow-up was queued rather than started.
    const { placeholderVariant, showSendWhileGenerating, showStopButton } =
      useConversationChatInputUiState({ isInputEmpty: !canSubmit });

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

    if (!canUseResource) return <OpStatusTray seamless />;

    // Surface the live running-op status flush above the reply affordance (seamless
    // inline row that renders nothing when idle), so the user can watch the agent
    // work without expanding the composer.
    if (!expanded) {
      return (
        <Flexbox gap={8}>
          <OpStatusTray seamless />
          <Button block icon={MessageCirclePlus} type={'fill'} onClick={() => setExpanded(true)}>
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
                  {!disableCollapse && (
                    <Button
                      icon={ChevronDownIcon}
                      size={'small'}
                      type={'text'}
                      onClick={() => setExpanded(false)}
                    >
                      {t('taskDetail.collapseReply')}
                    </Button>
                  )}
                  <AttachmentUploadButton onFiles={handleAttach} />
                </Flexbox>
              }
              right={
                showSendWhileGenerating ? (
                  // Stop keeps the running state on screen and Send joins it, so a
                  // typed follow-up is queued on click — the same pairing the main
                  // composer uses. Replacing Stop with Send read as "the run has
                  // finished" and made a queued follow-up look like a fresh run.
                  <Flexbox horizontal align={'center'} gap={8}>
                    <SendButton
                      generating
                      shape={'round'}
                      title={t('stop', { ns: 'common' })}
                      onStop={stopGenerating}
                    />
                    <SendButton
                      disabled={!canSubmit}
                      shape={'round'}
                      title={t('taskDetail.replyInThread')}
                      type={'primary'}
                      onClick={handleSubmit}
                    />
                  </Flexbox>
                ) : (
                  <SendButton
                    disabled={!canSubmit && !submitting}
                    generating={showStopButton}
                    loading={submitting}
                    shape={'round'}
                    // `onClick` stays off while generating: the editor's Stop
                    // branch fires `onStop` AND `onClick`, so a handler here would
                    // send the message the click was meant to cancel.
                    type={'primary'}
                    title={
                      showStopButton ? t('stop', { ns: 'common' }) : t('taskDetail.replyInThread')
                    }
                    onClick={showStopButton ? undefined : handleSubmit}
                    onStop={stopGenerating}
                  />
                )
              }
            />
          }
        >
          <EditorCanvas
            editor={editor}
            floatingToolbar={false}
            // Same copy switch as the main composer while the run is in flight —
            // what is being typed is a follow-up to the working run, not a fresh
            // reply into an idle thread.
            style={{ paddingBlock: 0 }}
            placeholder={
              placeholderVariant === 'followUp'
                ? t('followUpPlaceholder')
                : t('taskDetail.replyPlaceholder')
            }
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
  },
);

FeedbackInput.displayName = 'FeedbackInput';

export default FeedbackInput;

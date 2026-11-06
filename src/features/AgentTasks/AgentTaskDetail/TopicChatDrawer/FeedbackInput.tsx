import { ChatInput, ChatInputActionBar, SendButton, useEditor } from '@lobehub/editor/react';
import { Button, Flexbox } from '@lobehub/ui';
import { $getRoot } from 'lexical';
import { ChevronDownIcon, MessageCirclePlus } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { NoticeAlert } from '@/components/NoticeAlert';
import { AttachmentUploadButton } from '@/features/AttachmentInput';
import { FailedSendDrafts } from '@/features/Conversation/ChatInput/FailedSendDrafts';
import OpStatusTray from '@/features/Conversation/ChatInput/OpStatusTray';
import QueueTray from '@/features/Conversation/ChatInput/QueueTray';
import SendErrorAlert from '@/features/Conversation/ChatInput/SendErrorAlert';
import { useConversationChatInputUiState } from '@/features/Conversation/ChatInput/useConversationChatInputUiState';
import { useConversationResourceAccess } from '@/features/Conversation/hooks/useConversationResourceAccess';
import { messageStateSelectors, useConversationStore } from '@/features/Conversation/store';
import { EditorCanvas } from '@/features/EditorCanvas';
import {
  getAttachmentFileIdsFromEditor,
  hasIncompleteEditorAttachments,
  insertFilesIntoEditor,
} from '@/features/EditorCanvas/editorAttachments';
import { useEnterToSend } from '@/hooks/useEnterToSend';
import { useServerConfigStore } from '@/store/serverConfig';

import { taskGatewayAvailability } from './taskGatewayAvailability';
import { useComposerFocus } from './useComposerFocus';
import { useFollowUpQueue } from './useFollowUpQueue';
import { useTaskFollowUpSubmit } from './useTaskFollowUpSubmit';

interface FeedbackInputProps {
  /** Acceptance's in-flow topic rail starts with the composer visible. The
      floating Topic drawer keeps its compact, opt-in default. */
  defaultExpanded?: boolean;
  /** Hide the collapse affordance when the hosting surface intentionally pins
      the composer open, as Acceptance's in-flow right rail does. */
  disableCollapse?: boolean;
  /** Expand and focus the composer whenever this changes — the floating drawer
      opened by "Continue chat" wants the input hot, while read-first surfaces
      keep the compact, opt-in default. */
  focusRequest?: number;
}

const FeedbackInput = memo<FeedbackInputProps>(
  ({ defaultExpanded = false, disableCollapse = false, focusRequest }) => {
    const { t } = useTranslation('chat');
    const editor = useEditor();
    const gatewayAvailability = useServerConfigStore(taskGatewayAvailability);
    const stopGenerating = useConversationStore((s) => s.stopGenerating);
    const [hasContent, setHasContent] = useState(false);
    const [hasAttachments, setHasAttachments] = useState(false);
    const [uploadingAttachments, setUploadingAttachments] = useState(false);
    const sendMessageError = useConversationStore(messageStateSelectors.sendMessageError);
    const [dismissedSendError, setDismissedSendError] = useState<string>();
    const { handleSubmit, submitting } = useTaskFollowUpSubmit({
      editor,
      onClear: () => {
        setHasContent(false);
        setHasAttachments(false);
        setDismissedSendError(undefined);
      },
    });
    const { collapse, expand, expanded, handleEditorInit, reveal } = useComposerFocus({
      defaultExpanded,
      editor,
      focusRequest,
    });
    const shouldSendOnEnter = useEnterToSend();
    // Task follow-ups send into the shared agent's topic — view-only members
    // can watch the run but get no reply composer.
    const { canUseResource } = useConversationResourceAccess();

    // Follow-ups queued behind the running run are listed above the composer,
    // like the main chat input, so they can be edited, sent now or deleted.
    const { composerExpanded, hasQueuedMessages } = useFollowUpQueue({
      editor,
      enabled: canUseResource,
      expanded,
      reveal,
    });

    // Hold the send while an inline image is still uploading: its node still
    // carries the local `blob:` preview URL, and sending would hand the agent
    // a link it can never open.
    const canSubmit = (hasContent || hasAttachments) && !uploadingAttachments;
    // The run this drawer shows is a real op in its own conversation context, so
    // the composer reads the same op-derived send area as the main composer:
    // while the agent is working the control is Stop, and a typed follow-up
    // queues beside it instead of reading as a fresh send. Without it the drawer
    // offered Send during a running run — no way to stop it, and no sign that the
    // follow-up was queued rather than started.
    const { placeholderVariant, showSendWhileGenerating, showStopButton } =
      useConversationChatInputUiState({ isInputEmpty: !canSubmit });

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

    if (!canUseResource) return <OpStatusTray seamless />;
    if (gatewayAvailability !== 'available') {
      return (
        <Flexbox gap={8}>
          <FailedSendDrafts />
          <NoticeAlert
            description={t(`taskDetail.gateway.${gatewayAvailability}.description`)}
            title={t(`taskDetail.gateway.${gatewayAvailability}.title`)}
            type={'secondary'}
          />
          <OpStatusTray seamless />
        </Flexbox>
      );
    }

    const sendErrorAlert = sendMessageError && sendMessageError !== dismissedSendError && (
      <SendErrorAlert
        errorMessage={sendMessageError}
        onClose={() => setDismissedSendError(sendMessageError)}
      />
    );

    // Surface the live running-op status flush above the reply affordance (seamless
    // inline row that renders nothing when idle), so the user can watch the agent
    // work without expanding the composer.
    if (!composerExpanded) {
      return (
        <Flexbox gap={8}>
          <FailedSendDrafts />
          {sendErrorAlert}
          <OpStatusTray seamless />
          <Button block icon={MessageCirclePlus} type={'fill'} onClick={expand}>
            {t('taskDetail.sendFollowUp')}
          </Button>
        </Flexbox>
      );
    }

    return (
      <Flexbox gap={hasQueuedMessages ? 0 : 8}>
        <FailedSendDrafts />
        {sendErrorAlert}
        {hasQueuedMessages ? (
          // Same stack as the main composer: the queue and the run status ride
          // flush on the input as attached cards, inset from its edges.
          <Flexbox paddingInline={12}>
            <QueueTray />
            <OpStatusTray topAttached />
          </Flexbox>
        ) : (
          <OpStatusTray seamless />
        )}
        <ChatInput
          maxHeight={240}
          minHeight={64}
          footer={
            <ChatInputActionBar
              style={{ paddingInline: 8 }}
              left={
                <Flexbox horizontal align={'center'} gap={2}>
                  {!disableCollapse && !hasQueuedMessages && (
                    <Button icon={ChevronDownIcon} size={'small'} type={'text'} onClick={collapse}>
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
            onInit={handleEditorInit}
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

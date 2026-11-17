'use client';

import { type VoiceMessageRecording } from '@lobechat/types';
import { type SlashOptions } from '@lobehub/editor';
import {
  type ChatInputActionsProps,
  type ChatInputProps as EditorChatInputProps,
} from '@lobehub/editor/react';
import { Flexbox, toast } from '@lobehub/ui';
import i18next from 'i18next';
import { type ReactNode } from 'react';
import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import {
  getBusinessChatInputSendAreaPrefix,
  useBusinessChatInputAlerts,
} from '@/business/client/hooks/useBusinessChatInputSendAreaPrefix';
import type { ActionKeys, ChatInputFeature } from '@/features/ChatInput';
import { ChatInputProvider, DesktopChatInput } from '@/features/ChatInput';
import {
  needsSendTimeGit,
  prepareComposerGitSend,
  snapshotDraftGit,
} from '@/features/ChatInput/ControlBar/DraftGit';
import { resolveComposerHandoff } from '@/features/ChatInput/ControlBar/DraftGit/composerHandoff';
import {
  type SendButtonHandler,
  type SendButtonProps,
} from '@/features/ChatInput/store/initialState';
import { checkProjectExecution } from '@/features/Projects/WorkingDirectories/checkExecution';
import { useAgentStore } from '@/store/agent';
import { chatConfigByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { operationSelectors, topicSelectors } from '@/store/chat/selectors';
import { selectCurrentTurnTodosFromMessages } from '@/store/chat/slices/message/selectors/dbMessage';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { fileChatSelectors, useFileStore } from '@/store/file';

import { buildMessageContextSelections } from '../../ChatInput/utils/contextSelections';
import WideScreenContainer from '../../WideScreenContainer';
import { usePendingInterventions } from '../hooks/usePendingInterventions';
import InterventionBar from '../InterventionBar';
import {
  dataSelectors,
  messageStateSelectors,
  useConversationStore,
  useConversationStoreApi,
} from '../store';
import TodoProgress from '../TodoProgress';
import InputCompletionErrorAlert from './InputCompletionErrorAlert';
import LinkedGoalTray from './LinkedGoalTray';
import OpStatusTray from './OpStatusTray';
import QueueTray from './QueueTray';
import SendErrorAlert from './SendErrorAlert';
import { sendVoiceMessage } from './sendVoiceMessage';
import { transcribeVoiceMessage } from './transcribeVoiceMessage';
import { useConversationChatInputUiState } from './useConversationChatInputUiState';
import { useRestoreServerQueue } from './useRestoreServerQueue';
import {
  getContextWindow,
  getConversationSendButtonProps,
  partitionSendableUploads,
  toChatInputMessages,
} from './utils';
import {
  canSendVoiceMessage,
  isVoiceMessageTranscribed,
  useCanSendVoiceMessage,
} from './voiceMessageCapability';

/** Max recent messages to feed into auto-complete context (≈10 conversation turns) */
const MAX_CONTEXT_MESSAGES = 25;

export interface ChatInputProps {
  /**
   * Custom style for the action bar container
   */
  actionBarStyle?: React.CSSProperties;
  /**
   * Whether to allow fullscreen expand button
   */
  allowExpand?: boolean;
  /**
   * Custom children to render instead of default Desktop component.
   * Use this to add custom UI like error alerts, MessageFromUrl, etc.
   */
  children?: ReactNode;
  /**
   * Render the editor as a single-row strip by dropping the action bar footer.
   * Send still works through Enter; pair with `showControlBar={false}` to also
   * drop the control bar. Defaults to false — other chat surfaces stay untouched.
   */
  compact?: boolean;
  /**
   * Custom node to render in place of the default ControlBar
   * (Local/Cloud/Approval). When provided, replaces the default bar.
   */
  controlBarSlot?: ReactNode;
  /**
   * Suppress the followUp placeholder variant (e.g. onboarding has no
   * follow-up design). When true, placeholder stays in default variant.
   */
  disableFollowUpVariant?: boolean;
  /**
   * Disable enqueuing follow-up messages while the agent is streaming.
   * Hides the QueueTray and gates handleSend so Enter does not enqueue.
   */
  disableQueue?: boolean;
  /**
   * Externally force the send action off, regardless of input content. Grays
   * out the send button and gates handleSend so Enter can't send either. Used
   * by host surfaces that are temporarily read-only (e.g. the Page Agent when
   * another member holds the page edit lock).
   */
  disableSend?: boolean;
  /**
   * Extra action items to append to the ActionBar
   */
  extraActionItems?: ChatInputActionsProps['items'];
  /**
   * Chat input capability switches. Omitted capabilities keep the default enabled state.
   */
  feature?: ChatInputFeature;
  /**
   * Props forwarded to the editor's input container (e.g. a smaller default height)
   */
  inputContainerProps?: EditorChatInputProps;
  /**
   * Swap the action bar and send area for skeleton placeholders while
   * the underlying agent/session config is still hydrating. The editor
   * itself stays usable.
   */
  isConfigLoading?: boolean;
  /**
   * Left action buttons configuration
   */
  leftActions?: ActionKeys[];
  /**
   * Custom left content to replace the default ActionBar entirely
   */
  leftContent?: ReactNode;
  /**
   * Mention items for @ mentions (for group chat)
   */
  mentionItems?: SlashOptions['items'];
  /**
   * Blocking notices (device offline, cloud not configured, …). They ride at the
   * top of the composer's floating stack — above the run-status / queue / todo
   * trays, which stay next to the input they annotate, and on the same inline
   * edges as those trays so the stack reads as one column. Rendered as a sibling
   * above `ChatInput` instead, a notice would be covered by those trays, since
   * the stack floats upward from the top of this column.
   */
  notices?: ReactNode;
  /**
   * Callback when editor instance is ready
   */
  onEditorReady?: (editor: any) => void;
  /**
   * Right action buttons configuration
   */
  rightActions?: ActionKeys[];
  /**
   * Custom content to render before the SendArea (right side of action bar)
   */
  sendAreaPrefix?: ReactNode;
  /**
   * Custom send button props override
   */
  sendButtonProps?: Partial<SendButtonProps>;
  /**
   * Whether to show the control bar (Local/Cloud/Auto Approve)
   */
  showControlBar?: boolean;
  /**
   * Remove a small margin when placed adjacent to the ChatList
   */
  skipScrollMarginWithList?: boolean;
}

/**
 * ChatInput component for Conversation
 *
 * Uses ConversationStore for state management instead of global ChatStore.
 * Reuses the UI components from @/features/ChatInput.
 */
const ChatInput = memo<ChatInputProps>(
  ({
    actionBarStyle,
    allowExpand,
    compact = false,
    disableFollowUpVariant,
    disableQueue,
    disableSend,
    feature,
    inputContainerProps,
    leftActions = [],
    leftContent,
    rightActions = [],
    children,
    extraActionItems,
    isConfigLoading = false,
    mentionItems,
    notices,
    controlBarSlot,
    sendAreaPrefix,
    sendButtonProps: customSendButtonProps,
    showControlBar = true,
    onEditorReady,
    skipScrollMarginWithList,
  }) => {
    const { t } = useTranslation('chat');
    // ConversationStore state
    const storeApi = useConversationStoreApi();
    const dbMessages = useConversationStore(dataSelectors.dbMessages);
    const context = useConversationStore((s) => s.context);
    const contextKey = useMemo(() => messageMapKey(context), [context]);
    useRestoreServerQueue(context, !disableQueue);
    const canRecordVoiceMessage = useCanSendVoiceMessage(context);
    // The composer's controls must resolve their topic from THIS conversation,
    // not the global `activeTopicId`: a page copilot embedded next to another
    // chat runs with `topicId: null` while the outer chat's topic is still the
    // global one (see PageAgentProvider). `null` is meaningful — it means "this
    // conversation has no topic" — so it is passed through as-is.
    const [agentId, topicId, inputMessage, sendMessage, stopGenerating] = useConversationStore(
      (s) => [
        s.context.agentId,
        s.context.topicId ?? null,
        s.inputMessage,
        s.sendMessage,
        s.stopGenerating,
      ],
    );
    const [enableHistoryCount, historyCount] = useAgentStore((s) => [
      chatConfigByIdSelectors.getEnableHistoryCountById(agentId || '')(s),
      chatConfigByIdSelectors.getHistoryCountById(agentId || '')(s),
    ]);
    const chatInputMessages = useMemo(() => toChatInputMessages(dbMessages), [dbMessages]);
    const contextWindow = useMemo(
      () =>
        getContextWindow(dbMessages, {
          enableHistoryCount,
          historyCount,
        }),
      [dbMessages, enableHistoryCount, historyCount],
    );
    const getMessages = useCallback(
      () => chatInputMessages.slice(-MAX_CONTEXT_MESSAGES),
      [chatInputMessages],
    );
    const updateInputMessage = useConversationStore((s) => s.updateInputMessage);
    const setEditor = useConversationStore((s) => s.setEditor);
    const setChatInputOverlayHeight = useConversationStore((s) => s.setChatInputOverlayHeight);

    // Observe the floating overlay's height (TodoProgress + QueueTray) and
    // publish it so the ChatList container can reserve matching bottom
    // padding — keeps the overlay floating without occluding chat content.
    const overlayRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
      const node = overlayRef.current;
      if (!node) return;
      const observer = new ResizeObserver(([entry]) => {
        setChatInputOverlayHeight(Math.round(entry.contentRect.height));
      });
      observer.observe(node);
      return () => {
        observer.disconnect();
        setChatInputOverlayHeight(0);
      };
    }, [setChatInputOverlayHeight]);

    // Loading state from ConversationStore (bridged from ChatStore)
    const isInputQueueBlocked = useChatStore((s) =>
      operationSelectors.isInputLoadingByContext(context)(s),
    );
    const isSendDispatchPending = useChatStore((s) =>
      operationSelectors.isSendDispatchPendingByContext(context)(s),
    );

    const pendingInterventions = usePendingInterventions();
    const hasPendingInterventions = pendingInterventions.length > 0;

    // Send message error from ConversationStore
    const sendMessageErrorMsg = useConversationStore(messageStateSelectors.sendMessageError);
    const clearSendMessageError = useChatStore((s) => s.clearSendMessageError);

    // File store - for UI state only (disabled button, etc.)
    const fileList = useFileStore(fileChatSelectors.chatUploadFileList(contextKey));
    const contextList = useFileStore(fileChatSelectors.chatContextSelections(contextKey));

    // Queue state
    const hasQueuedMessages = useChatStore(
      (s) => operationSelectors.queuedMessageCount(context)(s) > 0,
    );

    // Detect whether TodoProgress will render (mirrors its own gating) so we
    // can square the top corners of OpStatusTray when it sits flush below.
    const hasTodos = (selectCurrentTurnTodosFromMessages(dbMessages)?.items.length ?? 0) > 0;

    // Detect whether OpStatusTray will render (mirrors its own `!startTime`
    // gate) so LinkedGoalTray — which sits flush below it — can square its top corners
    // and merge with the status strip instead of showing a seam.
    const hasOpStatus = useChatStore(
      (s) => operationSelectors.getVisibleAgentRuntimeStartTimeByContext(context)(s) !== undefined,
    );

    // Computed state
    const isInputEmpty = !inputMessage.trim() && fileList.length === 0 && contextList.length === 0;
    const { placeholderVariant, showSendWhileGenerating, showStopButton } =
      useConversationChatInputUiState({ disableFollowUpVariant, disableQueue, isInputEmpty });
    // Input stays enabled during agent execution — messages are queued.
    // When disableQueue is set (e.g. onboarding), block sending while loading.
    // disableSend hard-blocks regardless of content (host surface is read-only).
    // Uploads in flight do not block: the send is queued until they settle (see
    // `queueSendWhileUploading`).
    const disabled = isInputEmpty || (!!disableQueue && isInputQueueBlocked) || !!disableSend;

    // `disabled` above lags the editor: `inputMessage` mirrors content through
    // the editor's debounced onChange, so a fast type→Enter arrives while the
    // mirror still reads empty and the send would be silently dropped. Gate
    // Enter/click on live state instead — handleSend re-validates all of these
    // at trigger time, so this only mirrors the visual disabled semantics.
    const customDisabled = customSendButtonProps?.disabled;
    const resolveSendBlocked = useCallback(() => {
      if (disableSend) return true;

      const { context: liveContext, editor } = storeApi.getState();
      const liveContextKey = messageMapKey(liveContext);
      const fileStore = useFileStore.getState();
      if (customDisabled !== undefined) return customDisabled;

      if (
        disableQueue &&
        operationSelectors.isInputLoadingByContext(liveContext)(useChatStore.getState())
      )
        return true;

      const hasText = String(editor?.getMarkdownContent?.() || '').trim().length > 0;
      const hasFiles = fileChatSelectors.chatUploadFileList(liveContextKey)(fileStore).length > 0;
      const hasContextSelections =
        fileChatSelectors.chatContextSelections(liveContextKey)(fileStore).length > 0;
      return !hasText && !hasFiles && !hasContextSelections;
    }, [customDisabled, disableQueue, disableSend, storeApi]);
    const businessAlerts = useBusinessChatInputAlerts();
    const businessSendAreaPrefix = getBusinessChatInputSendAreaPrefix(sendAreaPrefix);

    // Send handler - gets message, clears editor immediately, then sends
    const handleSend: SendButtonHandler = useCallback(
      async ({ clearContent, getMarkdownContent, getEditorData }) => {
        // Host surface is read-only (e.g. page locked) — block Enter too, not
        // just the grayed-out button.
        if (disableSend) return;

        // Get instant values from stores at trigger time
        const fileStore = useFileStore.getState();
        const uploadList = fileChatSelectors.chatUploadFileList(contextKey)(fileStore);
        const currentIsUploading = fileChatSelectors.isUploadingFiles(contextKey)(fileStore);
        const currentContextList = fileChatSelectors.chatContextSelections(contextKey)(fileStore);

        // The composer queues a send until its uploads settle; reaching here with one
        // still in flight means the send came from elsewhere, which cannot wait.
        if (currentIsUploading) return;

        // A failed or cancelled upload has no file to attach. It is left out of the
        // message (its [Image #N] is pruned with it, so the numbers still match the
        // images sent) and stays in the composer to retry or remove.
        const { failed: failedUploads, sendable: currentFileList } =
          partitionSendableUploads(uploadList);
        // Said only once the send is settled (sent without them, or nothing left to
        // send), never ahead of a return that sends nothing for another reason.
        const notifyFailedUploads = () => {
          if (failedUploads.length === 0) return;
          toast.warning(t('input.uploadFailedNotSent', { count: failedUploads.length }));
        };

        // Onboarding-style surfaces opt out of message queuing — pressing Enter
        // while the agent is streaming should be a no-op rather than enqueue.
        if (disableQueue && isInputQueueBlocked) return;

        // Get content before clearing
        const message = getMarkdownContent();
        if (!message.trim() && currentFileList.length === 0 && currentContextList.length === 0) {
          // Only failed uploads were attached: the queued send ends with nothing sent.
          notifyFailedUploads();
          return;
        }

        // A rejected preflight has no persisted message to recover from. Keep
        // the composer and attachments intact until the target is usable.
        const chatState = useChatStore.getState();
        const sendContext = storeApi.getState().context;
        const topic = sendContext.topicId
          ? topicSelectors.getTopicById(sendContext.topicId)(chatState)
          : undefined;
        try {
          await checkProjectExecution(topic, chatState.isGatewayModeEnabled(sendContext.agentId));
        } catch (error) {
          console.error('Project execution preflight failed', error);
          toast.error(error instanceof Error ? error.message : String(error));
          return;
        }

        notifyFailedUploads();

        // Capture editor JSON state before clearing for rich text rendering
        const editorData = getEditorData();

        const clearComposer = () => {
          clearContent();
          fileStore.clearChatUploadFileList(
            contextKey,
            currentFileList.map((file) => file.id),
          );
          fileStore.clearChatContextSelections(contextKey);
        };

        // A deferred send was armed from the composer (see `scheduledSendAt`):
        // park the turn as a `scheduled` topic instead of running it. Send stays
        // the single commit action — picking a time never dispatches by itself.
        //
        // The composer is cleared only once the schedule is persisted, unlike the
        // normal path below: a rejected schedule (the picked time just went past,
        // the request failed) leaves no message row to recover the text from, so
        // an up-front clear would simply lose it.
        if (storeApi.getState().scheduledSendAt) {
          // The scheduled run is created server-side later and cannot switch
          // the picked branch or fork a worktree: refuse rather than drop them.
          if (needsSendTimeGit(snapshotDraftGit(sendContext, editorData))) {
            toast.error(i18next.t('workingDirectory.scheduleGitUnsupported', { ns: 'device' }));
            return;
          }
          const scheduled = await storeApi.getState().commitScheduledSend(message, currentFileList);
          if (scheduled) clearComposer();
          return;
        }

        // A new topic's first send acts on the branch picked in the composer
        // (switch, or fork a worktree) before any message exists. Cancelled or
        // failed, nothing is sent and the draft stays.
        const gitPrep = await prepareComposerGitSend(sendContext, { editorData });
        if (!gitPrep.ok) return;

        // Clear content immediately for responsive UX — unless a git step ran
        // and the composer changed hands meanwhile (see `resolveComposerHandoff`).
        const handoff = resolveComposerHandoff({
          acted: !!gitPrep.acted,
          editorUnchanged: getMarkdownContent() === message,
          stillHere: messageMapKey(storeApi.getState().context) === messageMapKey(sendContext),
        });
        if (handoff.clearEditor) clearContent();
        fileStore.clearChatUploadFileList(contextKey);
        fileStore.clearChatContextSelections(contextKey);

        const { contextSelections, pageSelections } =
          buildMessageContextSelections(currentContextList);

        // Fire and forget - send with captured message
        await sendMessage({
          contextSelections,
          editorData,
          files: currentFileList,
          message,
          ...(gitPrep.newTopicWorkingDirectory
            ? { newTopicWorkingDirectory: gitPrep.newTopicWorkingDirectory }
            : {}),
          ...(handoff.sendToOrigin ? { conversationContext: sendContext } : {}),
          onPreflightFailure: () => {
            const store = useFileStore.getState();
            // The composer was cleared up front; a send rejected before any
            // message owned the content must hand every part of it back —
            // uploads and context selections, not just the editor text the
            // lifecycle restores on its own.
            store.restoreChatUploadFileList(contextKey, currentFileList);
            store.restoreChatContextSelections(contextKey, currentContextList);
          },
          pageSelections,
        });
      },
      [contextKey, sendMessage, storeApi, disableQueue, disableSend, isInputQueueBlocked, t],
    );

    const sendButtonProps: SendButtonProps = getConversationSendButtonProps(
      {
        disabled,
        // While the message is still being created there is no run to stop yet:
        // Send shows as loading, and Stop takes over once the run starts.
        generating: showStopButton && !isSendDispatchPending,
        loading: isSendDispatchPending,
        onStop: stopGenerating,
        showSendWhileGenerating: showSendWhileGenerating && !isSendDispatchPending,
      },
      customSendButtonProps,
    );

    const handleVoiceMessageSend = useCallback(
      (recording: VoiceMessageRecording) => {
        if (operationSelectors.isInputVisiblyLoadingByContext(context)(useChatStore.getState())) {
          return false;
        }

        // Read the branch pick and worktree switch now: the send runs after
        // upload and transcription, by when the composer may show another
        // conversation.
        const gitSnapshot = snapshotDraftGit(context) ?? null;

        return Boolean(
          useChatStore.getState().sendVoiceMessage({
            canSend: canSendVoiceMessage,
            context,
            recording,
            send: (file, { context: targetContext, messageId, signal }) =>
              sendVoiceMessage(sendMessage, file, {
                context: targetContext,
                optimisticUserMessageId: messageId,
                // The same send-time git step as a typed first message.
                prepare: () =>
                  prepareComposerGitSend(targetContext ?? context, { snapshot: gitSnapshot }),
                signal,
                ...(isVoiceMessageTranscribed(targetContext)
                  ? {
                      transcribe: (uploaded, transcribeSignal) =>
                        transcribeVoiceMessage(uploaded.id, transcribeSignal),
                    }
                  : {}),
              }),
          }),
        );
      },
      [context, sendMessage],
    );

    const defaultContent = (
      <WideScreenContainer
        style={{ position: 'relative', ...(skipScrollMarginWithList ? { marginTop: -12 } : null) }}
      >
        {hasPendingInterventions && <InterventionBar interventions={pendingInterventions} />}
        {/* Keep the chat input mounted while an intervention panel is showing —
            unmounting would wipe the Lexical editor's in-memory document. */}
        <div style={{ display: hasPendingInterventions ? 'none' : 'contents' }}>
          {sendMessageErrorMsg && (
            <SendErrorAlert errorMessage={sendMessageErrorMsg} onClose={clearSendMessageError} />
          )}
          {businessAlerts}
          <Flexbox
            paddingInline={12}
            ref={overlayRef}
            style={{
              bottom: '100%',
              left: 12,
              position: 'absolute',
              right: 12,
              zIndex: 10,
            }}
          >
            {/* A blocking notice outranks the run it is blocking, so it heads the
                stack. It takes the overlay's own inset like every tray below it,
                so the whole floating column shares one pair of edges. */}
            {notices}
            <InputCompletionErrorAlert />
            {!disableQueue && hasQueuedMessages && <QueueTray />}
            <TodoProgress topAttached={!disableQueue && hasQueuedMessages} />
            <OpStatusTray topAttached={(!disableQueue && hasQueuedMessages) || hasTodos} />
            {/* Goals this conversation planned; sits last so it rides flush on the input. */}
            <LinkedGoalTray
              topAttached={(!disableQueue && hasQueuedMessages) || hasTodos || hasOpStatus}
            />
          </Flexbox>
          <DesktopChatInput
            actionBarStyle={actionBarStyle}
            borderRadius={12}
            compact={compact}
            controlBarSlot={controlBarSlot}
            extraActionItems={extraActionItems}
            hidden={hasPendingInterventions}
            inputContainerProps={inputContainerProps}
            isConfigLoading={isConfigLoading}
            leftContent={leftContent}
            placeholderVariant={placeholderVariant}
            sendAreaPrefix={businessSendAreaPrefix}
            showControlBar={showControlBar}
          />
        </div>
      </WideScreenContainer>
    );

    return (
      <ChatInputProvider
        queueSendWhileUploading
        agentId={agentId}
        allowExpand={allowExpand}
        canRecordVoiceMessage={canRecordVoiceMessage}
        contextSelectionKey={contextKey}
        contextWindow={contextWindow}
        draftKey={contextKey}
        feature={feature}
        getMessages={getMessages}
        leftActions={leftActions}
        mentionItems={mentionItems}
        resolveSendBlocked={resolveSendBlocked}
        rightActions={rightActions}
        sendButtonProps={sendButtonProps}
        slashPlacement="top"
        topicId={topicId}
        chatInputEditorRef={(instance) => {
          if (instance) {
            setEditor(instance);
            onEditorReady?.(instance);
          }
        }}
        onMarkdownContentChange={updateInputMessage}
        onSend={handleSend}
        onVoiceMessageSend={handleVoiceMessageSend}
      >
        {children ?? defaultContent}
      </ChatInputProvider>
    );
  },
);

ChatInput.displayName = 'ConversationChatInput';

export default ChatInput;

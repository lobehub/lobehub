'use client';

import { type SlashOptions } from '@lobehub/editor';
import { type ChatInputActionsProps } from '@lobehub/editor/react';
import { Alert, Flexbox, type MenuProps } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { type ReactNode } from 'react';
import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import {
  getBusinessChatInputSendAreaPrefix,
  useBusinessChatInputAlerts,
} from '@/business/client/hooks/useBusinessChatInputSendAreaPrefix';
import { useBusinessInputCompletionErrorAlert } from '@/business/client/hooks/useBusinessInputCompletionErrorAlert';
import type { ActionKeys, ChatInputFeature } from '@/features/ChatInput';
import { ChatInputProvider, DesktopChatInput } from '@/features/ChatInput';
import { selectors as chatInputSelectors, useChatInputStore } from '@/features/ChatInput/store';
import {
  type InputCompletionError,
  type SendButtonHandler,
  type SendButtonProps,
} from '@/features/ChatInput/store/initialState';
import { useAgentStore } from '@/store/agent';
import { chatConfigByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';
import { selectCurrentTurnTodosFromMessages } from '@/store/chat/slices/message/selectors/dbMessage';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { fileChatSelectors, useFileStore } from '@/store/file';

import { buildMessageContextSelections } from '../../ChatInput/utils/contextSelections';
import WideScreenContainer from '../../WideScreenContainer';
import InterventionBar from '../InterventionBar';
import {
  dataSelectors,
  messageStateSelectors,
  useConversationStore,
  useConversationStoreApi,
} from '../store';
import TodoProgress from '../TodoProgress';
import OpStatusTray from './OpStatusTray';
import QueueTray from './QueueTray';
import {
  getContextWindowMessages,
  getConversationChatInputUiState,
  toChatInputMessages,
} from './utils';
import GoalTray from './VerifyTray/GoalTray';

/** Max recent messages to feed into auto-complete context (≈10 conversation turns) */
const MAX_CONTEXT_MESSAGES = 25;

const InputCompletionErrorAlertContent = memo<{
  inputCompletionError: InputCompletionError;
}>(({ inputCompletionError }) => {
  const { t } = useTranslation('chat');
  const clearInputCompletionError = useChatInputStore((s) => s.clearInputCompletionError);
  const businessAlert = useBusinessInputCompletionErrorAlert({
    error: inputCompletionError,
    onRetry: clearInputCompletionError,
  });

  const action = businessAlert.action ?? (
    <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
      <Button size={'small'} type={'primary'} onClick={clearInputCompletionError}>
        {t('input.inputCompletionError.retry')}
      </Button>
      <Link to={'/settings/agent'}>
        <Button size={'small'}>{t('input.inputCompletionError.settings')}</Button>
      </Link>
    </Flexbox>
  );

  return (
    <>
      <Flexbox paddingBlock={'0 6px'} paddingInline={12}>
        <Alert
          showIcon
          action={action}
          description={businessAlert.description ?? t('input.inputCompletionError.desc')}
          title={t('input.inputCompletionError.title')}
          type={'warning'}
        />
      </Flexbox>
      {businessAlert.extra}
    </>
  );
});

InputCompletionErrorAlertContent.displayName = 'InputCompletionErrorAlertContent';

const InputCompletionErrorAlert = memo(() => {
  const inputCompletionError = useChatInputStore(chatInputSelectors.inputCompletionErrorVisible);

  if (!inputCompletionError) return null;

  return <InputCompletionErrorAlertContent inputCompletionError={inputCompletionError} />;
});

InputCompletionErrorAlert.displayName = 'InputCompletionErrorAlert';

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
   * Send menu configuration (for send options like Enter/Cmd+Enter, Add AI/User message)
   */
  sendMenu?: MenuProps;
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
    leftActions = [],
    leftContent,
    rightActions = [],
    children,
    extraActionItems,
    isConfigLoading = false,
    mentionItems,
    controlBarSlot,
    sendMenu,
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
    const draftKey = useMemo(() => messageMapKey(context), [context]);
    const [agentId, inputMessage, sendMessage, stopGenerating] = useConversationStore((s) => [
      s.context.agentId,
      s.inputMessage,
      s.sendMessage,
      s.stopGenerating,
    ]);
    const [enableHistoryCount, historyCount] = useAgentStore((s) => [
      chatConfigByIdSelectors.getEnableHistoryCountById(agentId || '')(s),
      chatConfigByIdSelectors.getHistoryCountById(agentId || '')(s),
    ]);
    const chatInputMessages = useMemo(() => toChatInputMessages(dbMessages), [dbMessages]);
    const contextWindowMessages = useMemo(
      () =>
        getContextWindowMessages(dbMessages, {
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
    const isInputLoading = useConversationStore(messageStateSelectors.isInputVisiblyLoading);
    const isInputQueueBlocked = useChatStore((s) =>
      operationSelectors.isInputLoadingByContext(context)(s),
    );

    // Pending interventions — use custom equality to prevent infinite re-render loop.
    // The selector creates new array/object refs each call; without equality check,
    // any store update → new ref → re-render → Intervention's store writes → loop.
    const pendingInterventions = useConversationStore(
      dataSelectors.pendingInterventions,
      (a, b) => {
        if (a.length !== b.length) return false;
        return a.every(
          (item, i) => item.toolCallId === b[i].toolCallId && item.requestArgs === b[i].requestArgs,
        );
      },
    );
    const hasPendingInterventions = pendingInterventions.length > 0;

    // Send message error from ConversationStore
    const sendMessageErrorMsg = useConversationStore(messageStateSelectors.sendMessageError);
    const clearSendMessageError = useChatStore((s) => s.clearSendMessageError);

    // File store - for UI state only (disabled button, etc.)
    const fileList = useFileStore(fileChatSelectors.chatUploadFileList);
    const contextList = useFileStore(fileChatSelectors.chatContextSelections);
    const isUploadingFiles = useFileStore(fileChatSelectors.isUploadingFiles);

    // Queue state
    const hasQueuedMessages = useChatStore(
      (s) => operationSelectors.queuedMessageCount(context)(s) > 0,
    );

    // Detect whether TodoProgress will render (mirrors its own gating) so we
    // can square the top corners of OpStatusTray when it sits flush below.
    const hasTodos = (selectCurrentTurnTodosFromMessages(dbMessages)?.items.length ?? 0) > 0;

    // Computed state
    const isInputEmpty = !inputMessage.trim() && fileList.length === 0 && contextList.length === 0;
    const { placeholderVariant, showSendMenu, showStopButton } = getConversationChatInputUiState({
      disableFollowUpVariant,
      isInputEmpty,
      isInputLoading,
    });
    // Input stays enabled during agent execution — messages are queued.
    // When disableQueue is set (e.g. onboarding), block sending while loading.
    // disableSend hard-blocks regardless of content (host surface is read-only).
    const disabled =
      isInputEmpty || isUploadingFiles || (!!disableQueue && isInputQueueBlocked) || !!disableSend;
    const shouldUsePlainSendButton = !showSendMenu && !!sendMenu;
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
        const currentFileList = fileChatSelectors.chatUploadFileList(fileStore);
        const currentIsUploading = fileChatSelectors.isUploadingFiles(fileStore);
        const currentContextList = fileChatSelectors.chatContextSelections(fileStore);

        if (currentIsUploading) return;

        // Onboarding-style surfaces opt out of message queuing — pressing Enter
        // while the agent is streaming should be a no-op rather than enqueue.
        if (disableQueue && isInputQueueBlocked) return;

        // Get content before clearing
        const message = getMarkdownContent();
        if (!message.trim() && currentFileList.length === 0 && currentContextList.length === 0)
          return;

        // Capture editor JSON state before clearing for rich text rendering
        const editorData = getEditorData();

        const clearComposer = () => {
          clearContent();
          fileStore.clearChatUploadFileList();
          fileStore.clearChatContextSelections();
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
          const scheduled = await storeApi.getState().commitScheduledSend(message, currentFileList);
          if (scheduled) clearComposer();
          return;
        }

        // Clear content immediately for responsive UX
        clearComposer();

        const { contextSelections, pageSelections } =
          buildMessageContextSelections(currentContextList);

        // Fire and forget - send with captured message
        await sendMessage({
          contextSelections,
          editorData,
          files: currentFileList,
          message,
          pageSelections,
        });
      },
      [sendMessage, storeApi, disableQueue, disableSend, isInputQueueBlocked],
    );

    const sendButtonProps: SendButtonProps = {
      disabled,
      generating: showStopButton,
      onStop: stopGenerating,
      ...customSendButtonProps,
      ...(shouldUsePlainSendButton
        ? { shape: customSendButtonProps?.shape ?? 'round' }
        : undefined),
    };

    const defaultContent = (
      <WideScreenContainer
        style={{ position: 'relative', ...(skipScrollMarginWithList ? { marginTop: -12 } : null) }}
      >
        {hasPendingInterventions && <InterventionBar interventions={pendingInterventions} />}
        {/* Keep the chat input mounted while an intervention panel is showing —
            unmounting would wipe the Lexical editor's in-memory document. */}
        <div style={{ display: hasPendingInterventions ? 'none' : 'contents' }}>
          {sendMessageErrorMsg && (
            <Flexbox paddingBlock={'0 6px'} paddingInline={12}>
              <Alert
                closable
                title={t('input.errorMsg', { errorMsg: sendMessageErrorMsg })}
                type={'secondary'}
                onClose={clearSendMessageError}
              />
            </Flexbox>
          )}
          <InputCompletionErrorAlert />
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
            {!disableQueue && hasQueuedMessages && <QueueTray />}
            <TodoProgress topAttached={!disableQueue && hasQueuedMessages} />
            <OpStatusTray topAttached={(!disableQueue && hasQueuedMessages) || hasTodos} />
            <GoalTray topAttached={(!disableQueue && hasQueuedMessages) || hasTodos} />
          </Flexbox>
          <DesktopChatInput
            actionBarStyle={actionBarStyle}
            borderRadius={12}
            compact={compact}
            controlBarSlot={controlBarSlot}
            extraActionItems={extraActionItems}
            hidden={hasPendingInterventions}
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
        agentId={agentId}
        allowExpand={allowExpand}
        contextWindowMessages={contextWindowMessages}
        draftKey={draftKey}
        feature={feature}
        getMessages={getMessages}
        leftActions={leftActions}
        mentionItems={mentionItems}
        rightActions={rightActions}
        sendButtonProps={sendButtonProps}
        sendMenu={showSendMenu ? sendMenu : undefined}
        slashPlacement="top"
        chatInputEditorRef={(instance) => {
          if (instance) {
            setEditor(instance);
            onEditorReady?.(instance);
          }
        }}
        onMarkdownContentChange={updateInputMessage}
        onSend={handleSend}
      >
        {children ?? defaultContent}
      </ChatInputProvider>
    );
  },
);

ChatInput.displayName = 'ConversationChatInput';

export default ChatInput;

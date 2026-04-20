'use client';

import { type SlashOptions } from '@lobehub/editor';
import { type ChatInputActionsProps } from '@lobehub/editor/react';
import { type MenuProps } from '@lobehub/ui';
import { Alert, Flexbox } from '@lobehub/ui';
import { type ReactNode } from 'react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { type ActionKeys } from '@/features/ChatInput';
import { ChatInputProvider, DesktopChatInput } from '@/features/ChatInput';
import {
  type SendButtonHandler,
  type SendButtonProps,
} from '@/features/ChatInput/store/initialState';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';
import { fileChatSelectors, useFileStore } from '@/store/file';

import WideScreenContainer from '../../WideScreenContainer';
import InterventionBar from '../InterventionBar';
import {
  dataSelectors,
  messageStateSelectors,
  useConversationStore,
  useConversationStoreApi,
} from '../store';
import QueueTray from './QueueTray';

/** Max recent messages to feed into auto-complete context (≈10 conversation turns) */
const MAX_CONTEXT_MESSAGES = 25;

const useGetMessages = () => {
  const storeApi = useConversationStoreApi();
  return useCallback(
    () =>
      dataSelectors
        .dbMessages(storeApi.getState())
        .filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'tool')
        .slice(-MAX_CONTEXT_MESSAGES)
        .map((m) => ({
          content: typeof m.content === 'string' ? m.content : '',
          role: m.role as 'user' | 'assistant' | 'system',
        })),
    [storeApi],
  );
};

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
   * Extra action items to append to the ActionBar
   */
  extraActionItems?: ChatInputActionsProps['items'];
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
   * Custom node to render in place of the default RuntimeConfig bar
   * (Local/Cloud/Approval). When provided, replaces the default bar.
   */
  runtimeConfigSlot?: ReactNode;
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
   * Whether to show the runtime config bar (Local/Cloud/Auto Approve)
   */
  showRuntimeConfig?: boolean;
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
    leftActions = [],
    leftContent,
    rightActions = [],
    children,
    extraActionItems,
    mentionItems,
    runtimeConfigSlot,
    sendMenu,
    sendAreaPrefix,
    sendButtonProps: customSendButtonProps,
    showRuntimeConfig = true,
    onEditorReady,
    skipScrollMarginWithList,
  }) => {
    const { t } = useTranslation('chat');

    const getMessages = useGetMessages();

    // ConversationStore state
    const context = useConversationStore((s) => s.context);
    const [agentId, inputMessage, sendMessage, stopGenerating] = useConversationStore((s) => [
      s.context.agentId,
      s.inputMessage,
      s.sendMessage,
      s.stopGenerating,
    ]);
    const updateInputMessage = useConversationStore((s) => s.updateInputMessage);
    const setEditor = useConversationStore((s) => s.setEditor);

    // Loading state from ConversationStore (bridged from ChatStore)
    const isInputLoading = useConversationStore(messageStateSelectors.isInputLoading);

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

    // Computed state
    const isInputEmpty = !inputMessage.trim() && fileList.length === 0 && contextList.length === 0;
    // Input stays enabled during agent execution — messages are queued
    const disabled = isInputEmpty || isUploadingFiles;

    // Send handler - gets message, clears editor immediately, then sends
    const handleSend: SendButtonHandler = useCallback(
      async ({ clearContent, getMarkdownContent, getEditorData }) => {
        // Get instant values from stores at trigger time
        const fileStore = useFileStore.getState();
        const currentFileList = fileChatSelectors.chatUploadFileList(fileStore);
        const currentIsUploading = fileChatSelectors.isUploadingFiles(fileStore);
        const currentContextList = fileChatSelectors.chatContextSelections(fileStore);

        if (currentIsUploading) return;

        // Get content before clearing
        const message = getMarkdownContent();
        if (!message.trim() && currentFileList.length === 0 && currentContextList.length === 0)
          return;

        // Capture editor JSON state before clearing for rich text rendering
        const editorData = getEditorData();

        // Clear content immediately for responsive UX
        clearContent();
        fileStore.clearChatUploadFileList();
        fileStore.clearChatContextSelections();

        // Convert ChatContextContent to PageSelection for persistence
        const pageSelections = currentContextList.map((ctx) => ({
          content: ctx.preview || '',
          id: ctx.id,
          pageId: ctx.pageId || '',
          xml: ctx.content,
        }));

        // Fire and forget - send with captured message
        await sendMessage({ editorData, files: currentFileList, message, pageSelections });
      },
      [sendMessage],
    );

    const sendButtonProps: SendButtonProps = {
      disabled,
      generating: isInputLoading,
      onStop: stopGenerating,
      ...customSendButtonProps,
    };

    const defaultContent = (
      <WideScreenContainer
        style={skipScrollMarginWithList ? { marginTop: -12, position: 'relative' } : undefined}
      >
        {hasPendingInterventions ? (
          <InterventionBar interventions={pendingInterventions} />
        ) : (
          <>
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
            {hasQueuedMessages && (
              <Flexbox
                paddingInline={12}
                style={{
                  position: 'absolute',
                  zIndex: 10,
                  bottom: '100%',
                  left: 12,
                  right: 12,
                }}
              >
                <QueueTray />
              </Flexbox>
            )}
            <DesktopChatInput
              actionBarStyle={actionBarStyle}
              borderRadius={12}
              extraActionItems={extraActionItems}
              leftContent={leftContent}
              runtimeConfigSlot={runtimeConfigSlot}
              sendAreaPrefix={sendAreaPrefix}
              showRuntimeConfig={showRuntimeConfig}
            />
          </>
        )}
      </WideScreenContainer>
    );

    return (
      <ChatInputProvider
        agentId={agentId}
        allowExpand={allowExpand}
        getMessages={getMessages}
        leftActions={leftActions}
        mentionItems={mentionItems}
        rightActions={rightActions}
        sendButtonProps={sendButtonProps}
        sendMenu={sendMenu}
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

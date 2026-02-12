'use client';

import { type SlashOptions } from '@lobehub/editor';
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
import { fileChatSelectors, useFileStore } from '@/store/file';

import WideScreenContainer from '../../WideScreenContainer';
import { messageStateSelectors, useConversationStore } from '../store';

export interface ChatInputProps {
  /**
   * Custom children to render instead of default Desktop component.
   * Use this to add custom UI like error alerts, MessageFromUrl, etc.
   */
  children?: ReactNode;
  /**
   * Left action buttons configuration
   */
  leftActions?: ActionKeys[];
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
   * Custom send button props override
   */
  sendButtonProps?: Partial<SendButtonProps>;
  /**
   * Send menu configuration (for send options like Enter/Cmd+Enter, Add AI/User message)
   */
  sendMenu?: MenuProps;
  /**
   * 与 ChatList 共同挨在一起的时候，将一点间距去掉
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
    leftActions = [],
    rightActions = [],
    children,
    mentionItems,
    sendMenu,
    sendButtonProps: customSendButtonProps,
    onEditorReady,
    skipScrollMarginWithList,
  }) => {
    const { t } = useTranslation('chat');

    // ConversationStore state
    const [agentId, inputMessage, sendMessage, stopGenerating] = useConversationStore((s) => [
      s.context.agentId,
      s.inputMessage,
      s.sendMessage,
      s.stopGenerating,
    ]);
    const updateInputMessage = useConversationStore((s) => s.updateInputMessage);
    const setEditor = useConversationStore((s) => s.setEditor);

    // Generation state from ConversationStore (bridged from ChatStore)
    const isAIGenerating = useConversationStore(messageStateSelectors.isAIGenerating);

    // Send message error from ConversationStore
    const sendMessageErrorMsg = useConversationStore(messageStateSelectors.sendMessageError);
    const clearSendMessageError = useChatStore((s) => s.clearSendMessageError);

    // File store - for UI state only (disabled button, etc.)
    const fileList = useFileStore(fileChatSelectors.chatUploadFileList);
    const contextList = useFileStore(fileChatSelectors.chatContextSelections);
    const isUploadingFiles = useFileStore(fileChatSelectors.isUploadingFiles);

    // Computed state
    const isInputEmpty = !inputMessage.trim() && fileList.length === 0 && contextList.length === 0;
    const disabled = isInputEmpty || isUploadingFiles || isAIGenerating;

    // Send handler - gets message, clears editor immediately, then sends
    const handleSend: SendButtonHandler = useCallback(
      async ({ clearContent, getMarkdownContent }) => {
        // Get instant values from stores at trigger time
        const fileStore = useFileStore.getState();
        const currentFileList = fileChatSelectors.chatUploadFileList(fileStore);
        const currentIsUploading = fileChatSelectors.isUploadingFiles(fileStore);
        const currentContextList = fileChatSelectors.chatContextSelections(fileStore);

        if (currentIsUploading || isAIGenerating) return;

        // Get content before clearing
        const message = getMarkdownContent();
        if (!message.trim() && currentFileList.length === 0 && currentContextList.length === 0)
          return;

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
        await sendMessage({ files: currentFileList, message, pageSelections });
      },
      [isAIGenerating, sendMessage],
    );

    const sendButtonProps: SendButtonProps = {
      disabled,
      generating: isAIGenerating,
      onStop: stopGenerating,
      ...customSendButtonProps,
    };

    const defaultContent = (
      <WideScreenContainer style={skipScrollMarginWithList ? { marginTop: -12 } : undefined}>
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
        <DesktopChatInput />
      </WideScreenContainer>
    );

    return (
      <ChatInputProvider
        agentId={agentId}
        leftActions={leftActions}
        mentionItems={mentionItems}
        rightActions={rightActions}
        sendButtonProps={sendButtonProps}
        sendMenu={sendMenu}
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

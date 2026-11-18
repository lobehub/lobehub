import { useEditor } from '@lobehub/editor/react';
import type { ReactNode } from 'react';
import { memo, useRef } from 'react';

import ReasoningConfigLoader from './ReasoningConfigLoader';
import { createStore, Provider } from './store';
import { DEFAULT_CHAT_INPUT_FEATURE } from './store/initialState';
import type { StoreUpdaterProps } from './StoreUpdater';
import StoreUpdater from './StoreUpdater';

interface ChatInputProviderProps extends StoreUpdaterProps {
  children: ReactNode;
}

export const ChatInputProvider = memo<ChatInputProviderProps>(
  ({
    agentId,
    canRecordVoiceMessage,
    children,
    contextSelectionKey,
    contextWindow,
    draftKey,
    feature = DEFAULT_CHAT_INPUT_FEATURE,
    leftActions,
    rightActions,
    mobile,
    sendButtonProps,
    onSend,
    onVoiceMessageSend,
    chatInputEditorRef,
    onMarkdownContentChange,
    mentionItems,
    allowExpand = true,
    slashPlacement,
    getMessages,
    queueSendWhileUploading,
    resolveSendBlocked,
    topicId,
    uploadContextKey,
  }) => {
    const editor = useEditor();
    const slashMenuRef = useRef<HTMLDivElement>(null);

    return (
      <Provider
        createStore={() =>
          createStore({
            allowExpand,
            canRecordVoiceMessage,
            contextSelectionKey,
            contextWindow,
            draftKey,
            editor,
            feature,
            leftActions,
            mentionItems,
            mobile,
            rightActions,
            onVoiceMessageSend,
            sendButtonProps,
            slashMenuRef,
            slashPlacement,
            topicId,
            uploadContextKey,
          })
        }
      >
        <StoreUpdater
          agentId={agentId}
          allowExpand={allowExpand}
          canRecordVoiceMessage={canRecordVoiceMessage}
          chatInputEditorRef={chatInputEditorRef}
          contextSelectionKey={contextSelectionKey}
          contextWindow={contextWindow}
          draftKey={draftKey}
          feature={feature}
          getMessages={getMessages}
          leftActions={leftActions}
          mentionItems={mentionItems}
          mobile={mobile}
          queueSendWhileUploading={queueSendWhileUploading}
          resolveSendBlocked={resolveSendBlocked}
          rightActions={rightActions}
          sendButtonProps={sendButtonProps}
          slashPlacement={slashPlacement}
          topicId={topicId}
          uploadContextKey={uploadContextKey}
          onMarkdownContentChange={onMarkdownContentChange}
          onSend={onSend}
          onVoiceMessageSend={onVoiceMessageSend}
        />
        <ReasoningConfigLoader />
        {children}
      </Provider>
    );
  },
);

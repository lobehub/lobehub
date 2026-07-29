import { memo, type ReactNode, useMemo } from 'react';

import {
  type ActionKeys,
  ChatInputProvider,
  DesktopChatInput,
  type SendButtonHandler,
} from '@/features/ChatInput';
import { useChatStore } from '@/store/chat';

import { HOME_INPUT_BODY_HEIGHT } from './constants';

const leftActions: ActionKeys[] = ['agentMode', 'plus'];
const rightActions: ActionKeys[] = ['modelLabel'];

export interface HomeEditorInputProps {
  agentId?: string;
  initialValue: string;
  isAgentConfigLoading: boolean;
  loading: boolean;
  onValueChange: (value: string) => void;
  placeholder?: ReactNode;
  send: SendButtonHandler;
}

const HomeEditorInput = memo<HomeEditorInputProps>(
  ({ agentId, initialValue, isAgentConfigLoading, loading, onValueChange, placeholder, send }) => {
    const inputContainerProps = useMemo(
      () => ({
        minHeight: HOME_INPUT_BODY_HEIGHT,
        resize: false,
        style: {
          borderRadius: 20,
          boxShadow: '0 12px 32px rgba(0,0,0,.04)',
        },
      }),
      [],
    );

    return (
      <ChatInputProvider
        agentId={agentId}
        allowExpand={false}
        leftActions={leftActions}
        rightActions={rightActions}
        slashPlacement="bottom"
        chatInputEditorRef={(instance) => {
          if (!instance) return;
          useChatStore.setState({ mainInputEditor: instance });
        }}
        sendButtonProps={{
          disabled: loading || isAgentConfigLoading,
          generating: loading,
          onStop: () => {},
          shape: 'round',
        }}
        onMarkdownContentChange={onValueChange}
        onSend={send}
      >
        <DesktopChatInput
          dropdownPlacement="bottomLeft"
          initialContent={initialValue}
          inputContainerProps={inputContainerProps}
          isConfigLoading={isAgentConfigLoading}
          placeholder={placeholder}
          showControlBar={false}
        />
      </ChatInputProvider>
    );
  },
);

HomeEditorInput.displayName = 'HomeEditorInput';

export default HomeEditorInput;

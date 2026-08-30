import { Flexbox } from '@lobehub/ui';
import { ActionIcon } from '@lobehub/ui/base-ui';
import { PlusIcon } from 'lucide-react';
import { memo, type ReactNode, useMemo } from 'react';

import {
  type ActionKeys,
  ChatInputProvider,
  DesktopChatInput,
  type SendButtonHandler,
} from '@/features/ChatInput';
import ActionBar from '@/features/ChatInput/ActionBar';
import { useChatStore } from '@/store/chat';

import type { HomeMode } from '../types';
import { HOME_INPUT_BODY_HEIGHT } from './constants';
import ModeSelect from './ModeSelect';

const leftActions: ActionKeys[] = ['plus'];
const rightActions: ActionKeys[] = ['model'];

const CONTAINER_RADIUS = 20;
/** Clearance from the container edge to the round controls sitting in its corners. */
const ACTION_BAR_INSET = 8;

export interface HomeEditorInputProps {
  agentId?: string;
  contextSelectionKey: string;
  initialValue: string;
  isAgentConfigLoading: boolean;
  loading: boolean;
  mode: HomeMode;
  onModeChange: (mode: HomeMode) => void;
  onValueChange: (value: string) => void;
  placeholder?: ReactNode;
  send: SendButtonHandler;
}

const HomeEditorInput = memo<HomeEditorInputProps>(
  ({
    agentId,
    contextSelectionKey,
    initialValue,
    isAgentConfigLoading,
    loading,
    mode,
    onModeChange,
    onValueChange,
    placeholder,
    send,
  }) => {
    const inputContainerProps = useMemo(
      () => ({
        minHeight: HOME_INPUT_BODY_HEIGHT,
        resize: false,
        style: {
          borderRadius: CONTAINER_RADIUS,
          boxShadow: '0 1px 2px rgba(0,0,0,.03), 0 12px 32px rgba(0,0,0,.04)',
        },
      }),
      [],
    );

    const actionBarStyle = useMemo(
      () => ({
        paddingBlockEnd: ACTION_BAR_INSET,
        paddingInline: ACTION_BAR_INSET,
      }),
      [],
    );

    return (
      <ChatInputProvider
        agentId={agentId}
        allowExpand={false}
        contextSelectionKey={contextSelectionKey}
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
          actionBarStyle={actionBarStyle}
          dropdownPlacement="bottomLeft"
          initialContent={initialValue}
          inputContainerProps={inputContainerProps}
          placeholder={placeholder}
          showControlBar={false}
          leftContent={
            <Flexbox horizontal align={'center'} gap={2}>
              <ModeSelect value={mode} onChange={onModeChange} />
              {mode !== 'chat' ? null : isAgentConfigLoading ? (
                <ActionIcon disabled icon={PlusIcon} size={'small'} />
              ) : (
                <ActionBar disableCollapse dropdownPlacement="bottomLeft" />
              )}
            </Flexbox>
          }
        />
      </ChatInputProvider>
    );
  },
);

HomeEditorInput.displayName = 'HomeEditorInput';

export default HomeEditorInput;

import { Flexbox } from '@lobehub/ui';
import { useMemo } from 'react';

import DragUploadZone, { useUploadFiles } from '@/components/DragUploadZone';
import { type ActionKeys, ChatInputProvider, DesktopChatInput } from '@/features/ChatInput';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { useHomeStore } from '@/store/home';

import ModeHeader from './ModeHeader';
import StarterList from './StarterList';
import { useSend } from './useSend';

const leftActions: ActionKeys[] = ['model', 'search', 'fileUpload'];

const InputArea = () => {
  const { loading, send, inboxAgentId } = useSend();
  const inputActiveMode = useHomeStore((s) => s.inputActiveMode);

  // Get agent's model info for vision support check
  const model = useAgentStore((s) => agentByIdSelectors.getAgentModelById(inboxAgentId)(s));
  const provider = useAgentStore((s) =>
    agentByIdSelectors.getAgentModelProviderById(inboxAgentId)(s),
  );
  const { handleUploadFiles } = useUploadFiles({ model, provider });

  // A slot to insert content above the chat input
  // Override some default behavior of the chat input
  const inputContainerProps = useMemo(
    () => ({
      minHeight: 88,
      resize: false,
      style: {
        borderRadius: 20,
        boxShadow: '0 12px 32px rgba(0,0,0,.04)',
      },
    }),
    [inputActiveMode],
  );

  return (
    <Flexbox gap={16} style={{ marginBottom: 16 }}>
      <DragUploadZone onUploadFiles={handleUploadFiles}>
        <ChatInputProvider
          agentId={inboxAgentId}
          chatInputEditorRef={(instance) => {
            if (!instance) return;
            useChatStore.setState({ mainInputEditor: instance });
          }}
          leftActions={leftActions}
          onMarkdownContentChange={(content) => {
            useChatStore.setState({ inputMessage: content });
          }}
          onSend={send}
          sendButtonProps={{
            disabled: loading,
            generating: loading,
            onStop: () => {},
            shape: 'round',
          }}
        >
          <DesktopChatInput
            dropdownPlacement="bottomLeft"
            extenHeaderContent={inputActiveMode ? <ModeHeader /> : undefined}
            inputContainerProps={inputContainerProps}
          />
        </ChatInputProvider>
      </DragUploadZone>

      <StarterList />
    </Flexbox>
  );
};

export default InputArea;

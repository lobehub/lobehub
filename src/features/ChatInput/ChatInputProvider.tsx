import { useEditor } from '@lobehub/editor/react';
import { type ReactNode, memo, useRef } from 'react';

import StoreUpdater, { type StoreUpdaterProps } from './StoreUpdater';
import { Provider, createStore } from './store';

interface ChatInputProviderProps extends StoreUpdaterProps {
  children: ReactNode;
}

export const ChatInputProvider = memo<ChatInputProviderProps>(
  ({
    agentId,
    children,
    leftActions,
    rightActions,
    mobile,
    sendButtonProps,
    onSend,
    sendMenu,
    chatInputEditorRef,
    onMarkdownContentChange,
    mentionItems,
    allowExpand = true,
  }) => {
    const editor = useEditor();
    const slashMenuRef = useRef<HTMLDivElement>(null);

    return (
      <Provider
        createStore={() =>
          createStore({
            allowExpand,
            editor,
            leftActions,
            mentionItems,
            mobile,
            rightActions,
            sendButtonProps,
            sendMenu,
            slashMenuRef,
          })
        }
      >
        <StoreUpdater
          agentId={agentId}
          allowExpand={allowExpand}
          chatInputEditorRef={chatInputEditorRef}
          leftActions={leftActions}
          mentionItems={mentionItems}
          mobile={mobile}
          onMarkdownContentChange={onMarkdownContentChange}
          onSend={onSend}
          rightActions={rightActions}
          sendButtonProps={sendButtonProps}
          sendMenu={sendMenu}
        />
        {children}
      </Provider>
    );
  },
);

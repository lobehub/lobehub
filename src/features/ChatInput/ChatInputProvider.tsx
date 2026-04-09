import { useEditor } from '@lobehub/editor/react';
import { type ReactNode } from 'react';
import { memo, useRef } from 'react';

import { createStore, Provider } from './store';
import { type StoreUpdaterProps } from './StoreUpdater';
import StoreUpdater from './StoreUpdater';

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
    slashPlacement,
    getMessages,
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
            slashPlacement,
          })
        }
      >
        <StoreUpdater
          agentId={agentId}
          allowExpand={allowExpand}
          chatInputEditorRef={chatInputEditorRef}
          getMessages={getMessages}
          leftActions={leftActions}
          mentionItems={mentionItems}
          mobile={mobile}
          rightActions={rightActions}
          sendButtonProps={sendButtonProps}
          sendMenu={sendMenu}
          slashPlacement={slashPlacement}
          onMarkdownContentChange={onMarkdownContentChange}
          onSend={onSend}
        />
        {children}
      </Provider>
    );
  },
);

import { useEditor } from '@lobehub/editor/react';
import { type MutableRefObject, type ReactNode, memo, useRef } from 'react';

import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

import StoreUpdater, { type StoreUpdaterProps } from './StoreUpdater';
import { Provider, createStore } from './store';

interface ChatInputProviderProps extends StoreUpdaterProps {
  children: ReactNode;
}

interface ChatInputProviderInnerProps extends StoreUpdaterProps {
  children: ReactNode;
  contentRef: MutableRefObject<string>;
}

const ChatInputProviderInner = memo<ChatInputProviderInnerProps>(
  ({
    agentId,
    children,
    contentRef,
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
            contentRef,
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

export const ChatInputProvider = (props: ChatInputProviderProps) => {
  const enableRichRender = useUserStore(labPreferSelectors.enableInputMarkdown);
  // Ref to persist content across re-mounts when enableRichRender changes
  const contentRef = useRef<string>('');

  return (
    <ChatInputProviderInner contentRef={contentRef} key={`editor-${enableRichRender}`} {...props} />
  );
};

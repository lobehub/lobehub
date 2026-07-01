'use client';

import { memo, type ReactNode } from 'react';

import { messageStateSelectors, useConversationStore } from '../store';
import SelectionFloatBar from './SelectionFloatBar';

interface MessageForwardFooterProps {
  children: ReactNode;
}

/**
 * Wraps the chat composer: while multi-selecting it hides the input and floats
 * the selection action pill over the bottom of the conversation. The input stays
 * mounted but display:none so the editor/draft state survives toggling selection
 * mode.
 */
const MessageForwardFooter = memo<MessageForwardFooterProps>(({ children }) => {
  const isSelectionMode = useConversationStore(messageStateSelectors.isSelectionMode);

  return (
    <>
      <div style={isSelectionMode ? { display: 'none' } : { display: 'contents' }}>{children}</div>
      {isSelectionMode && <SelectionFloatBar />}
    </>
  );
});

MessageForwardFooter.displayName = 'MessageForwardFooter';

export default MessageForwardFooter;

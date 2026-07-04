'use client';

import { memo, type ReactNode } from 'react';

import { messageStateSelectors, useConversationStore } from '../store';
import SelectionFooterBar from './SelectionFooterBar';

interface MessageForwardFooterProps {
  children: ReactNode;
}

/**
 * Wraps the chat composer: while multi-selecting it hides the input and docks
 * the selection action bar at the bottom in its place. The input stays mounted
 * but display:none so the editor/draft state survives toggling selection mode.
 */
const MessageForwardFooter = memo<MessageForwardFooterProps>(({ children }) => {
  const isSelectionMode = useConversationStore(messageStateSelectors.isSelectionMode);

  return (
    <>
      <div style={isSelectionMode ? { display: 'none' } : { display: 'contents' }}>{children}</div>
      {isSelectionMode && <SelectionFooterBar />}
    </>
  );
});

MessageForwardFooter.displayName = 'MessageForwardFooter';

export default MessageForwardFooter;

'use client';

import { memo } from 'react';

import { type ActionKeys } from '@/features/ChatInput';
import { ChatInput } from '@/features/Conversation';
import { useChatStore } from '@/store/chat';

const leftActions: ActionKeys[] = [
  'search',
  'memory',
  'fileUpload',
  'tools',
  'voiceDictation',
  '---',
  ['typo', 'params', 'clear'],
];

const rightActions: ActionKeys[] = ['model', 'voiceMessage', 'contextWindow'];
const sendButtonProps = { shape: 'round' } as const;

/**
 * MainChatInput
 *
 * Custom ChatInput implementation for main chat page.
 * Uses ChatInput from @/features/Conversation which handles all send logic
 * including error alerts display.
 * Only adds MessageFromUrl for desktop mode.
 */
const MainChatInput = memo(() => {
  return (
    <ChatInput
      skipScrollMarginWithList
      leftActions={leftActions}
      rightActions={rightActions}
      sendButtonProps={sendButtonProps}
      onEditorReady={(instance) => {
        // Sync to global ChatStore for compatibility with other features
        useChatStore.setState({ mainInputEditor: instance });
      }}
    />
  );
});

MainChatInput.displayName = 'MainChatInput';

export default MainChatInput;

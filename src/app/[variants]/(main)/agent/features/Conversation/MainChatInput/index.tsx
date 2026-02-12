'use client';

import { memo } from 'react';

import { type ActionKeys } from '@/features/ChatInput';
import { ChatInput } from '@/features/Conversation';
import { useChatStore } from '@/store/chat';

import { useSendMenuItems } from './useSendMenuItems';

const leftActions: ActionKeys[] = [
  'model',
  'search',
  'fileUpload',
  'tools',
  '---',
  ['typo', 'params', 'clear'],
  'mainToken',
];

const rightActions: ActionKeys[] = [];

/**
 * MainChatInput
 *
 * Custom ChatInput implementation for main chat page.
 * Uses ChatInput from @/features/Conversation which handles all send logic
 * including error alerts display.
 * Only adds MessageFromUrl for desktop mode.
 */
const MainChatInput = memo(() => {
  const sendMenuItems = useSendMenuItems();

  return (
    <ChatInput
      leftActions={leftActions}
      onEditorReady={(instance) => {
        // Sync to global ChatStore for compatibility with other features
        useChatStore.setState({ mainInputEditor: instance });
      }}
      rightActions={rightActions}
      sendMenu={{ items: sendMenuItems }}
      skipScrollMarginWithList
    />
  );
});

MainChatInput.displayName = 'MainChatInput';

export default MainChatInput;

'use client';

import { memo } from 'react';

import { type ActionKeys } from '@/features/ChatInput';
import { ActionBarContext } from '@/features/ChatInput/ActionBar/context';
import {
  COMPACT_ACTION_BAR_CONTEXT,
  COMPACT_ACTION_BAR_STYLE,
  COMPACT_SEND_BUTTON_PROPS,
} from '@/features/ChatInput/compactPreset';
import { ChatInput } from '@/features/Conversation';
import { useImLayout } from '@/features/NavRail/useImLayout';
import { useChatStore } from '@/store/chat';

import { useSendMenuItems } from './useSendMenuItems';

// Single-row editor for the channel composer; it still grows with content.
const SLIM_INPUT_PROPS = { defaultHeight: 36 };

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

  // `im_layout` opens conversations as channels: the slim composer preset of
  // the side panels (small actions and send button, no control bar).
  const imLayout = useImLayout();

  const input = (
    <ChatInput
      skipScrollMarginWithList
      actionBarStyle={imLayout ? COMPACT_ACTION_BAR_STYLE : undefined}
      inputContainerProps={imLayout ? SLIM_INPUT_PROPS : undefined}
      leftActions={leftActions}
      rightActions={rightActions}
      sendButtonProps={imLayout ? COMPACT_SEND_BUTTON_PROPS : undefined}
      sendMenu={{ items: sendMenuItems }}
      showControlBar={!imLayout}
      onEditorReady={(instance) => {
        // Sync to global ChatStore for compatibility with other features
        useChatStore.setState({ mainInputEditor: instance });
      }}
    />
  );

  if (!imLayout) return input;

  return <ActionBarContext value={COMPACT_ACTION_BAR_CONTEXT}>{input}</ActionBarContext>;
});

MainChatInput.displayName = 'MainChatInput';

export default MainChatInput;

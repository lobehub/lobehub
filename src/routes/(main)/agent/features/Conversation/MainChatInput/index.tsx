'use client';

import { memo, useMemo } from 'react';

import { type ActionKeys } from '@/features/ChatInput';
import { ChatInput } from '@/features/Conversation';
import { contextSelectors, useConversationStore } from '@/features/Conversation/store';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';

import AgentConfigError from './AgentConfigError';
import { useSendMenuItems } from './useSendMenuItems';

const rightActions: ActionKeys[] = [
  'model',
  'promptTransform',
  'voiceMessage',
  'contextWindow',
];

/**
 * MainChatInput
 *
 * Custom ChatInput implementation for main chat page.
 * Uses ChatInput from @/features/Conversation which handles all send logic
 * including error alerts display.
 * Only adds MessageFromUrl for desktop mode.
 */
const MainChatInput = memo(() => {
  const isDevMode = useUserStore((s) => userGeneralSettingsSelectors.config(s).isDevMode);
  const sendMenuItems = useSendMenuItems();

  const agentId = useConversationStore(contextSelectors.agentId);
  const isAgentConfigLoading = useAgentStore(agentByIdSelectors.isAgentConfigLoadingById(agentId));

  // The model chip lives on the right, next to Send (see rightActions); the
  // left bar keeps the "+" menu, dictation and the expand toggle.
  const leftActions: ActionKeys[] = useMemo(() => ['plus', 'voiceDictation'], []);

  return (
    <>
      <AgentConfigError />
      <ChatInput
        skipScrollMarginWithList
        isConfigLoading={isAgentConfigLoading}
        leftActions={leftActions}
        rightActions={rightActions}
        {...(isDevMode
          ? { sendMenu: { items: sendMenuItems } }
          : { sendButtonProps: { shape: 'round' } })}
        onEditorReady={(instance) => {
          // Sync to global ChatStore for compatibility with other features
          useChatStore.setState({ mainInputEditor: instance });
        }}
      />
    </>
  );
});

MainChatInput.displayName = 'MainChatInput';

export default MainChatInput;

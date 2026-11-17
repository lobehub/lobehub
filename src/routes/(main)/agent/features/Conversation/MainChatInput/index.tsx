'use client';

import { memo, useMemo } from 'react';

import { type ActionKeys } from '@/features/ChatInput';
import { ChatInput } from '@/features/Conversation';
import { contextSelectors, useConversationStore } from '@/features/Conversation/store';
import { useModelSupportImageOutput } from '@/hooks/useModelSupportImageOutput';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';

import AgentConfigError from './AgentConfigError';

const contextWindowRightActions: ActionKeys[] = ['model', 'voiceMessage', 'contextWindow'];
const promptTransformRightActions: ActionKeys[] = [
  'model',
  'promptTransform',
  'voiceMessage',
  'contextWindow',
];
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
  const agentId = useConversationStore(contextSelectors.agentId);
  const model = useAgentStore(agentByIdSelectors.getAgentModelById(agentId));
  const provider = useAgentStore(agentByIdSelectors.getAgentModelProviderById(agentId));
  const isAgentConfigLoading = useAgentStore(agentByIdSelectors.isAgentConfigLoadingById(agentId));
  const supportsImageOutput = useModelSupportImageOutput(model, provider);
  const rightActions = supportsImageOutput
    ? promptTransformRightActions
    : contextWindowRightActions;

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
        sendButtonProps={sendButtonProps}
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

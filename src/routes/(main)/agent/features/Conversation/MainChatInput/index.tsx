'use client';

import { memo, useMemo } from 'react';

import { type ActionKeys } from '@/features/ChatInput';
import { ChatInput } from '@/features/Conversation';
import { useModelSupportImageOutput } from '@/hooks/useModelSupportImageOutput';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';

import { useSendMenuItems } from './useSendMenuItems';

const contextWindowRightActions: ActionKeys[] = ['contextWindow'];
const promptTransformRightActions: ActionKeys[] = ['promptTransform', 'contextWindow'];

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

  const model = useAgentStore(agentSelectors.currentAgentModel);
  const provider = useAgentStore(agentSelectors.currentAgentModelProvider);
  const isAgentConfigLoading = useAgentStore(agentSelectors.isAgentConfigLoading);
  const supportsImageOutput = useModelSupportImageOutput(model, provider);
  const rightActions = supportsImageOutput
    ? promptTransformRightActions
    : contextWindowRightActions;

  const leftActions: ActionKeys[] = useMemo(() => ['model', 'plus'], []);

  return (
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
  );
});

MainChatInput.displayName = 'MainChatInput';

export default MainChatInput;

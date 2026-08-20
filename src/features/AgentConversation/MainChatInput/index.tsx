'use client';

import { memo } from 'react';

import { type ActionKeys } from '@/features/ChatInput';
import { ChatInput } from '@/features/Conversation';
import { contextSelectors, useConversationStore } from '@/features/Conversation/store';
import { useModelSupportImageOutput } from '@/hooks/useModelSupportImageOutput';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';

import AgentConfigError from './AgentConfigError';
import { useSendMenuItems } from './useSendMenuItems';

const contextWindowRightActions: ActionKeys[] = ['model', 'voiceMessage', 'contextWindow'];
const promptTransformRightActions: ActionKeys[] = [
  'model',
  'promptTransform',
  'voiceMessage',
  'contextWindow',
];

// The model chip lives on the right, next to Send (see the right-action lists).
const defaultLeftActions: ActionKeys[] = ['plus', 'voiceDictation'];

export interface MainChatInputProps {
  /** Force-disable sending, e.g. on the visitor share page before the share execution chain lands. */
  disableSend?: boolean;
  /** Override the built-in left actions, e.g. to hide owner controls for share visitors. */
  leftActions?: ActionKeys[];
  /**
   * Override the built-in right actions. Share visitors pass `[]` — the voice
   * message action sends through its own path that ignores `disableSend`.
   */
  rightActions?: ActionKeys[];
}

/**
 * MainChatInput
 *
 * Custom ChatInput implementation for main chat page.
 * Uses ChatInput from @/features/Conversation which handles all send logic
 * including error alerts display.
 * Only adds MessageFromUrl for desktop mode.
 */
const MainChatInput = memo<MainChatInputProps>(({ disableSend, leftActions, rightActions }) => {
  const isDevMode = useUserStore((s) => userGeneralSettingsSelectors.config(s).isDevMode);
  const sendMenuItems = useSendMenuItems();

  const agentId = useConversationStore(contextSelectors.agentId);
  const model = useAgentStore(agentByIdSelectors.getAgentModelById(agentId));
  const provider = useAgentStore(agentByIdSelectors.getAgentModelProviderById(agentId));
  const isAgentConfigLoading = useAgentStore(agentByIdSelectors.isAgentConfigLoadingById(agentId));
  const supportsImageOutput = useModelSupportImageOutput(model, provider);
  const defaultRightActions = supportsImageOutput
    ? promptTransformRightActions
    : contextWindowRightActions;

  return (
    <>
      <AgentConfigError />
      <ChatInput
        skipScrollMarginWithList
        disableSend={disableSend}
        isConfigLoading={isAgentConfigLoading}
        leftActions={leftActions ?? defaultLeftActions}
        rightActions={rightActions ?? defaultRightActions}
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

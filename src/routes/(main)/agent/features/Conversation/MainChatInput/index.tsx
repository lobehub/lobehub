'use client';

import { memo, useMemo } from 'react';

import { type ActionKeys } from '@/features/ChatInput';
import { ActionBarContext } from '@/features/ChatInput/ActionBar/context';
import {
  COMPACT_ACTION_BAR_CONTEXT,
  COMPACT_ACTION_BAR_STYLE,
  COMPACT_SEND_BUTTON_PROPS,
} from '@/features/ChatInput/compactPreset';
import { ChatInput } from '@/features/Conversation';
import { contextSelectors, useConversationStore } from '@/features/Conversation/store';
import { useImLayout } from '@/features/NavRail/useImLayout';
import { useModelSupportImageOutput } from '@/hooks/useModelSupportImageOutput';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';

import AgentConfigError from './AgentConfigError';
import { useSendMenuItems } from './useSendMenuItems';

// Single-row editor for the channel composer; it still grows with content.
const SLIM_INPUT_PROPS = { defaultHeight: 36 };

const contextWindowRightActions: ActionKeys[] = ['model', 'voiceMessage', 'contextWindow'];
const promptTransformRightActions: ActionKeys[] = [
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
  // `im_layout` opens conversations as channels: the slim composer preset of
  // the side panels (small actions and send button, no control bar).
  const imLayout = useImLayout();

  const input = (
    <ChatInput
      skipScrollMarginWithList
      actionBarStyle={imLayout ? COMPACT_ACTION_BAR_STYLE : undefined}
      inputContainerProps={imLayout ? SLIM_INPUT_PROPS : undefined}
      isConfigLoading={isAgentConfigLoading}
      leftActions={leftActions}
      rightActions={rightActions}
      showControlBar={!imLayout}
      {...(isDevMode
        ? { sendMenu: { items: sendMenuItems } }
        : {
            sendButtonProps: imLayout
              ? { ...COMPACT_SEND_BUTTON_PROPS, shape: 'round' }
              : { shape: 'round' },
          })}
      onEditorReady={(instance) => {
        // Sync to global ChatStore for compatibility with other features
        useChatStore.setState({ mainInputEditor: instance });
      }}
    />
  );

  return (
    <>
      <AgentConfigError />
      {imLayout ? (
        <ActionBarContext value={COMPACT_ACTION_BAR_CONTEXT}>{input}</ActionBarContext>
      ) : (
        input
      )}
    </>
  );
});

MainChatInput.displayName = 'MainChatInput';

export default MainChatInput;

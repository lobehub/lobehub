'use client';

import { Flexbox } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import DragUploadZone, { useUploadFiles } from '@/components/DragUploadZone';
import {
  COMPACT_ACTION_BAR_STYLE,
  COMPACT_SEND_BUTTON_PROPS,
} from '@/features/ChatInput/compactPreset';
import {
  ChatInput,
  ChatList,
  conversationSelectors,
  useConversationStore,
} from '@/features/Conversation';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';

import { GoalChatProvider } from './GoalChatProvider';
import Toolbar from './Toolbar';

const EMPTY_LEFT_ACTIONS: [] = [];

const Welcome = memo(() => {
  const { t } = useTranslation('chat');
  return (
    <Flexbox align={'center'} flex={1} justify={'center'} padding={24}>
      <Text style={{ fontSize: 14, textAlign: 'center' }} type={'secondary'}>
        {t('goalChat.welcome')}
      </Text>
    </Flexbox>
  );
});

Welcome.displayName = 'GoalChatWelcome';

const Conversation = memo<{ onCollapse: () => void }>(({ onCollapse }) => {
  const useFetchAgentConfig = useAgentStore((s) => s.useFetchAgentConfig);
  const currentAgentId = useConversationStore(conversationSelectors.agentId);

  useFetchAgentConfig(true, currentAgentId);

  const model = useAgentStore((s) => agentByIdSelectors.getAgentModelById(currentAgentId)(s));
  const provider = useAgentStore((s) =>
    agentByIdSelectors.getAgentModelProviderById(currentAgentId)(s),
  );
  const { handleUploadFiles } = useUploadFiles({ agentId: currentAgentId, model, provider });

  return (
    <DragUploadZone style={{ flex: 1, height: '100%' }} onUploadFiles={handleUploadFiles}>
      <Flexbox flex={1} height={'100%'} style={{ overflow: 'hidden' }}>
        <Toolbar onCollapse={onCollapse} />
        <Flexbox flex={1} style={{ overflow: 'hidden' }}>
          <ChatList welcome={<Welcome />} />
        </Flexbox>
        <ChatInput
          actionBarStyle={COMPACT_ACTION_BAR_STYLE}
          allowExpand={false}
          leftActions={EMPTY_LEFT_ACTIONS}
          sendButtonProps={COMPACT_SEND_BUTTON_PROPS}
          showControlBar={false}
        />
      </Flexbox>
    </DragUploadZone>
  );
});

Conversation.displayName = 'GoalChatConversation';

interface GoalChatProps {
  agentId: string;
  goalId: string;
  onCollapse: () => void;
}

/**
 * The goal page's side conversation with the goal's responsible agent. The
 * provider tags the context with `viewedGoal`, so every question is answered
 * with the current goal overview injected — "how is this going?" just works.
 */
const GoalChat = memo<GoalChatProps>(({ agentId, goalId, onCollapse }) => (
  <GoalChatProvider agentId={agentId} goalId={goalId}>
    <Conversation onCollapse={onCollapse} />
  </GoalChatProvider>
));

GoalChat.displayName = 'GoalChat';

export default GoalChat;

'use client';

import { Flexbox } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import DragUploadZone, { useUploadFiles } from '@/components/DragUploadZone';
import { ChatList, conversationSelectors, useConversationStore } from '@/features/Conversation';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';

import { GoalChatProvider } from './GoalChatProvider';
import GoalConversationInput from './GoalConversationInput';
import Toolbar from './Toolbar';

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

interface ConversationProps {
  initialMessage?: string;
  onCollapse: () => void;
  onInitialMessageSent?: () => void;
}

const Conversation = memo<ConversationProps>(
  ({ initialMessage, onCollapse, onInitialMessageSent }) => {
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
          <GoalConversationInput
            initialMessage={initialMessage}
            onInitialMessageSent={onInitialMessageSent}
          />
        </Flexbox>
      </DragUploadZone>
    );
  },
);

Conversation.displayName = 'GoalChatConversation';

interface GoalChatProps {
  agentId: string;
  goalId: string;
  /** Sent on mount — the result page's composer hands its text over this way. */
  initialMessage?: string;
  initialTopicId?: string;
  onCollapse: () => void;
  onInitialMessageSent?: () => void;
}

/**
 * The goal page's side conversation with the goal's responsible agent. The
 * provider tags the context with `viewedGoal`, so every question is answered
 * with the current goal overview injected — "how is this going?" just works.
 */
const GoalChat = memo<GoalChatProps>(
  ({ agentId, goalId, initialMessage, initialTopicId, onCollapse, onInitialMessageSent }) => (
    <GoalChatProvider agentId={agentId} goalId={goalId} initialTopicId={initialTopicId}>
      <Conversation
        initialMessage={initialMessage}
        onCollapse={onCollapse}
        onInitialMessageSent={onInitialMessageSent}
      />
    </GoalChatProvider>
  ),
);

GoalChat.displayName = 'GoalChat';

export default GoalChat;

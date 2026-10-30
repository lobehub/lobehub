import { agentDisplayName } from '@lobechat/types';
import { Flexbox, Text } from '@lobehub/ui';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { ChatList } from '@/features/Conversation';
import MessageItem from '@/features/Conversation/Messages';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

import { GoalChatProvider } from './GoalChat/GoalChatProvider';
import GoalConversationInput from './GoalChat/GoalConversationInput';
import Toolbar from './GoalChat/Toolbar';

interface GoalSupervisionProps {
  agentId: string;
  goalId: string;
  /** Sent into the record once it loads — the result page's composer hands off this way. */
  initialMessage?: string;
  onCollapse: () => void;
  onInitialMessageConsumed?: () => void;
  topicId: string;
}

/**
 * A management conversation freshly moved to another agent has no turns yet.
 * Say so, instead of leaving the panel with an empty list.
 */
const WaitingForFirstRun = memo(() => {
  const { t } = useTranslation('chat');
  return (
    <Flexbox align={'center'} flex={1} justify={'center'} padding={24}>
      <Text style={{ fontSize: 14, textAlign: 'center' }} type={'secondary'}>
        {t('goalProcess.manager.pending')}
      </Text>
    </Flexbox>
  );
});

WaitingForFirstRun.displayName = 'GoalSupervisionWaiting';

/**
 * The manager's ongoing record, and the place to talk to it. Past turns stay
 * read-only — editing one would rewrite what the manager acted on — but the
 * conversation itself continues here, so the reader never has to leave the goal
 * to answer a question the manager asked in it.
 */
export const GoalSupervision = ({
  agentId,
  goalId,
  initialMessage,
  onCollapse,
  onInitialMessageConsumed,
  topicId,
}: GoalSupervisionProps) => {
  const { t } = useTranslation('chat');
  const useFetchAgentConfig = useAgentStore((s) => s.useFetchAgentConfig);
  useFetchAgentConfig(true, agentId);
  const agentTitle = useAgentStore((s) =>
    agentDisplayName(agentSelectors.getAgentMetaById(agentId)(s)),
  );
  // Stable renderer for the virtualized history; past turns are not editable.
  const itemContent = useCallback(
    (index: number, id: string) => <MessageItem disableEditing id={id} index={index} />,
    [],
  );
  return (
    <GoalChatProvider pinned agentId={agentId} goalId={goalId} initialTopicId={topicId}>
      <Flexbox height={'100%'} style={{ overflow: 'hidden' }}>
        {/* The side chat's header, locked to the record: the goal is bound to
            this topic, so the panel offers no new conversation and no history. */}
        <Toolbar
          topicLocked
          fallbackTitle={agentTitle || t('goalProcess.manager.title')}
          onCollapse={onCollapse}
        />
        <Flexbox flex={1} style={{ minHeight: 0, overflow: 'hidden' }}>
          <ChatList disableActionsBar itemContent={itemContent} welcome={<WaitingForFirstRun />} />
        </Flexbox>
        <GoalConversationInput
          initialMessage={initialMessage}
          onInitialMessageConsumed={onInitialMessageConsumed}
        />
      </Flexbox>
    </GoalChatProvider>
  );
};

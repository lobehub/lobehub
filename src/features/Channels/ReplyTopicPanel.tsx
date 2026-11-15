import { AGENT_CHAT_TOPIC_URL } from '@lobechat/const';
import type { ConversationContext } from '@lobechat/types';
import { ActionIcon, Flexbox, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { ExternalLink, X } from 'lucide-react';
import { Activity, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AgentAvatar from '@/components/AgentAvatar';
import ChatList from '@/features/Conversation/ChatList';
import { ConversationProvider } from '@/features/Conversation/ConversationProvider';
import MessageItem from '@/features/Conversation/Messages';
import NavHeader from '@/features/NavHeader';
import RightPanel from '@/features/RightPanel';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useOperationState } from '@/hooks/useOperationState';
import { useAgentStore } from '@/store/agent';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

import { styles } from './styles';
import { THREAD_FLOAT_BREAKPOINT } from './ThreadPanel';

/** The Agent topic a channel reply was produced in. */
export interface ReplyTopic {
  agentId: string;
  avatar: string | null;
  name: string;
  title?: string | null;
  topicId: string;
}

const renderMessage = (index: number, id: string) => (
  <MessageItem disableEditing id={id} index={index} key={id} />
);

/**
 * The topic's messages, read-only. Writing here would add turns the Channel never saw, so
 * follow-ups go through the Channel or the full topic page.
 */
const TopicConversation = ({ agentId, topicId }: { agentId: string; topicId: string }) => {
  const isLogin = useUserStore(authSelectors.isLogin);
  const useHydrateAgentConfig = useAgentStore((s) => s.useHydrateAgentConfig);
  useHydrateAgentConfig(isLogin, agentId);
  const context = useMemo<ConversationContext>(
    () => ({ agentId, isolatedTopic: true, scope: 'main', topicId }),
    [agentId, topicId],
  );
  const operationState = useOperationState(context);
  return (
    <ConversationProvider context={context} operationState={operationState}>
      <Flexbox flex={1} style={{ minHeight: 0, overflow: 'hidden' }}>
        <ChatList disableActionsBar itemContent={renderMessage} />
      </Flexbox>
    </ConversationProvider>
  );
};

/** The Agent topic behind a reply, beside the Channel like a thread. */
export function ReplyTopicPanel({
  availableWidth = 1000,
  topic,
  onClose,
}: {
  availableWidth?: number;
  onClose: () => void;
  topic: ReplyTopic | null;
}) {
  const { t } = useTranslation('channel');
  const navigate = useWorkspaceAwareNavigate();
  // Keep the last topic mounted while the panel animates closed.
  const [lastTopic, setLastTopic] = useState(topic);
  const [preferredWidth, setPreferredWidth] = useState(520);
  if (topic && topic !== lastTopic) setLastTopic(topic);
  const narrow = availableWidth < THREAD_FLOAT_BREAKPOINT;
  const maxWidth = narrow ? availableWidth : availableWidth - 360;
  const width = Math.min(preferredWidth, maxWidth);

  return (
    <RightPanel
      className={stylex.props(styles.threadPanel).className}
      classNames={{ content: stylex.props(styles.threadContent).className }}
      expand={!!topic}
      maxWidth={maxWidth}
      minWidth={Math.min(360, maxWidth)}
      mode={narrow ? 'float' : 'fixed'}
      showHandleWhenCollapsed={false}
      showHandleWideArea={false}
      width={narrow ? availableWidth : width}
      onExpandChange={(expand) => {
        if (!expand) onClose();
      }}
      onSizeChange={(size) => {
        const next = Number.parseFloat(String(size?.width));
        if (Number.isFinite(next)) setPreferredWidth(next);
      }}
    >
      <Activity mode={topic ? 'visible' : 'hidden'}>
        <Flexbox aria-label={t('topic.title')} role="region" {...stylex.props(styles.body)}>
          <NavHeader
            paddingBlock={6}
            paddingInline={8}
            showTogglePanelButton={false}
            left={
              lastTopic && (
                <Flexbox
                  horizontal
                  align="center"
                  gap={8}
                  style={{ marginInlineStart: 4, minWidth: 0 }}
                >
                  <AgentAvatar
                    agentId={lastTopic.agentId}
                    avatar={lastTopic.avatar}
                    name={lastTopic.name}
                    shape={'circle'}
                    size={20}
                  />
                  <Text ellipsis fontSize={14}>
                    {lastTopic.title || t('topic.titleNamed', { name: lastTopic.name })}
                  </Text>
                </Flexbox>
              )
            }
            right={
              <Flexbox horizontal align="center" gap={4}>
                {lastTopic && (
                  <ActionIcon
                    aria-label={t('topic.openPage')}
                    icon={ExternalLink}
                    size="small"
                    title={t('topic.openPage')}
                    onClick={() =>
                      navigate(AGENT_CHAT_TOPIC_URL(lastTopic.agentId, lastTopic.topicId))
                    }
                  />
                )}
                <ActionIcon
                  aria-label={t('topic.close')}
                  icon={X}
                  size="small"
                  title={t('topic.close')}
                  onClick={onClose}
                />
              </Flexbox>
            }
            {...stylex.props(styles.threadHeader)}
          />
          {lastTopic && (
            <TopicConversation
              agentId={lastTopic.agentId}
              key={lastTopic.topicId}
              topicId={lastTopic.topicId}
            />
          )}
        </Flexbox>
      </Activity>
    </RightPanel>
  );
}

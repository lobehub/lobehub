import { AGENT_CHAT_TOPIC_URL, GROUP_CHAT_TOPIC_URL } from '@lobechat/const';
import { agentDisplayName } from '@lobechat/types';
import { Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, type ReactNode } from 'react';

import AgentAvatar from '@/components/AgentAvatar';
import { useAgentDisplayMeta } from '@/features/AgentTasks/shared/useAgentDisplayMeta';
import Time from '@/features/Home/components/Time';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

import { resolveTopicTriggerTime, RunningElapsedTime } from './RunningElapsedTime';
import { type InboxTopic } from './useHomeInboxTopics';

const styles = stylex.create({
  row: {
    cursor: 'pointer',
    paddingBlock: '8px',
    paddingInline: '10px',
    borderRadius: cssVar.borderRadius,
    transition: `background ${cssVar.motionDurationFast}`,
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillQuaternary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
});

/**
 * Where a topic opens: its agent's chat, or its group's chat for a group
 * conversation (which carries no `agentId`). Undefined when it has neither.
 */
export const getTopicChatUrl = (
  topic: Pick<InboxTopic, 'agentId' | 'groupId' | 'id'>,
): string | undefined => {
  if (topic.agentId) return AGENT_CHAT_TOPIC_URL(topic.agentId, topic.id);
  if (topic.groupId) return GROUP_CHAT_TOPIC_URL(topic.groupId, topic.id);
  return undefined;
};

interface TopicRowProps {
  /** Rendered last, after the time — e.g. an explicit "open" button. */
  action?: ReactNode;
  /** Status glyph or live spinner — supplied by the caller so a running row can spin. */
  leading: ReactNode;
  topic: InboxTopic;
  trailing?: ReactNode;
}

const TopicRow = memo<TopicRowProps>(({ action, topic, leading, trailing }) => {
  const navigate = useWorkspaceAwareNavigate();
  const agent = useAgentDisplayMeta(topic.agentId);

  const open = () => {
    const url = getTopicChatUrl(topic);
    if (url) navigate(url);
  };

  return (
    <Flexbox
      horizontal
      align={'center'}
      className={stylex.props(styles.row).className}
      gap={10}
      onClick={open}
    >
      {leading}
      {agent && (
        <AgentAvatar
          agentId={topic.agentId}
          avatar={agent.avatar}
          background={agent.backgroundColor}
          shape={'circle'}
          size={22}
          style={{ flex: 'none' }}
          title={agentDisplayName(agent)}
        />
      )}
      <Flexbox horizontal align={'center'} flex={1} gap={6} style={{ minWidth: 0 }}>
        <Text ellipsis fontSize={13} style={{ minWidth: 0 }}>
          {topic.title}
        </Text>
        <RunningElapsedTime startTime={topic.runStartedAt} />
      </Flexbox>
      {trailing}
      <Time
        date={resolveTopicTriggerTime(topic.runStartedAt, topic.updatedAt ?? topic.createdAt)}
      />
      {action}
    </Flexbox>
  );
});

export default TopicRow;

import { AGENT_CHAT_TOPIC_URL } from '@lobechat/const';
import { Avatar, Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo, type ReactNode } from 'react';

import { useAgentDisplayMeta } from '@/features/AgentTasks/shared/useAgentDisplayMeta';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import Time from '@/routes/(main)/home/features/components/Time';

import { resolveTopicTriggerTime, RunningElapsedTime } from './RunningElapsedTime';
import { type InboxTopic } from './useHomeInboxTopics';

const styles = createStaticStyles(({ css, cssVar }) => ({
  row: css`
    cursor: pointer;

    padding-block: 8px;
    padding-inline: 10px;
    border-radius: ${cssVar.borderRadius};

    transition: background ${cssVar.motionDurationFast};

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
}));

interface TopicRowProps {
  /** Status glyph or live spinner — supplied by the caller so a running row can spin. */
  leading: ReactNode;
  topic: InboxTopic;
  trailing?: ReactNode;
}

const TopicRow = memo<TopicRowProps>(({ topic, leading, trailing }) => {
  const navigate = useWorkspaceAwareNavigate();
  const agent = useAgentDisplayMeta(topic.agentId);

  const open = () => {
    if (!topic.agentId) return;
    navigate(AGENT_CHAT_TOPIC_URL(topic.agentId, topic.id));
  };

  return (
    <Flexbox horizontal align={'center'} className={styles.row} gap={10} onClick={open}>
      {leading}
      {agent && (
        <Avatar
          avatar={agent.avatar}
          background={agent.backgroundColor}
          shape={'circle'}
          size={22}
          style={{ flex: 'none' }}
          title={agent.title}
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
    </Flexbox>
  );
});

export default TopicRow;

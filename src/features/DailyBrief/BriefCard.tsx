import { DEFAULT_AVATAR } from '@lobechat/const';
import { Avatar, Block, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { type CSSProperties, memo } from 'react';

import Time from '@/routes/(main)/home/features/components/Time';

import BriefCardActions from './BriefCardActions';
import BriefCardSummary from './BriefCardSummary';
import BriefIcon from './BriefIcon';
import { type AgentAvatarInfo, type BriefItem } from './types';

const AVATAR_SIZE = 20;

const getAvatarStyle = (index: number): CSSProperties => ({
  border: `1.5px solid ${cssVar.colorBgContainer}`,
  marginInlineStart: index === 0 ? 0 : -6,
  zIndex: index,
});

interface AgentAvatarsProps {
  agents: AgentAvatarInfo[];
}

const AgentAvatars = memo<AgentAvatarsProps>(({ agents }) => {
  if (agents.length === 0) return null;

  return (
    <Flexbox horizontal align={'center'} style={{ paddingInlineEnd: 4 }}>
      {agents.map((agent, index) => (
        <Avatar
          avatar={agent.avatar || DEFAULT_AVATAR}
          background={agent.backgroundColor || undefined}
          key={agent.id}
          shape={'circle'}
          size={AVATAR_SIZE}
          style={getAvatarStyle(index)}
        />
      ))}
    </Flexbox>
  );
});

interface BriefCardProps {
  brief: BriefItem;
}

const BriefCard = memo<BriefCardProps>(({ brief }) => {
  return (
    <Block padding={16} style={{ borderRadius: cssVar.borderRadiusLG }} variant={'outlined'}>
      <Flexbox gap={12}>
        <Flexbox horizontal align={'center'} justify={'space-between'}>
          <Flexbox horizontal align={'center'} gap={8} style={{ overflow: 'hidden' }}>
            <BriefIcon type={brief.type} />
            <Text ellipsis fontSize={16} style={{ flex: 1 }} weight={500}>
              {brief.title}
            </Text>
            {brief.agents.length > 0 && <AgentAvatars agents={brief.agents} />}
          </Flexbox>
          <Time date={brief.createdAt} />
        </Flexbox>
        <BriefCardSummary summary={brief.summary} />
        <BriefCardActions
          briefId={brief.id}
          briefType={brief.type}
          resolvedAction={brief.resolvedAction}
          taskId={brief.taskId}
        />
      </Flexbox>
    </Block>
  );
});

export default BriefCard;

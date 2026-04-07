import { DEFAULT_AVATAR } from '@lobechat/const';
import { Avatar, Block, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { Lightbulb } from 'lucide-react';
import { type CSSProperties, memo } from 'react';

import Time from '@/routes/(main)/home/features/components/Time';

import BriefCardActions from './BriefCardActions';
import BriefCardSummary from './BriefCardSummary';
import { BRIEF_TYPE_COLOR, BRIEF_TYPE_ICON } from './const';
import { type AgentAvatarInfo, type BriefItem } from './types';

const CSS_VAR_COLOR_MAP: Record<string, string> = {
  error: cssVar.colorError,
  result: cssVar.colorSuccess,
};

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
  const icon = BRIEF_TYPE_ICON[brief.type] || Lightbulb;
  const color =
    BRIEF_TYPE_COLOR[brief.type as keyof typeof BRIEF_TYPE_COLOR] ??
    CSS_VAR_COLOR_MAP[brief.type] ??
    cssVar.colorPrimary;

  return (
    <Block padding={16} style={{ borderRadius: cssVar.borderRadiusLG }} variant={'outlined'}>
      <Flexbox gap={12}>
        <Flexbox horizontal align={'center'} justify={'space-between'}>
          <Flexbox horizontal align={'center'} gap={8} style={{ overflow: 'hidden' }}>
            <Icon color={color} icon={icon} size={28} />
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

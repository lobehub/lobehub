import { DEFAULT_AVATAR, INBOX_SESSION_ID } from '@lobechat/const';
import { Avatar, Block, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { DEFAULT_INBOX_AVATAR } from '@/const/meta';
import Time from '@/routes/(main)/home/features/components/Time';

import BriefCardActions from './BriefCardActions';
import BriefCardSummary from './BriefCardSummary';
import BriefIcon from './BriefIcon';
import { styles } from './style';
import { type AgentAvatarInfo, type BriefItem } from './types';

interface AgentAvatarsProps {
  agents: AgentAvatarInfo[];
}

const AgentAvatars = memo<AgentAvatarsProps>(({ agents }) => {
  const { t } = useTranslation('common');
  if (agents.length === 0) return null;

  return (
    <Avatar.Group
      shadow
      size={28}
      items={agents.map((agent, index) => {
        const isInbox = agent?.id === INBOX_SESSION_ID;
        return {
          avatar: agent?.avatar || (isInbox ? DEFAULT_INBOX_AVATAR : DEFAULT_AVATAR),
          background: agent.backgroundColor || cssVar.colorBgContainer,
          key: agent.id || index.toString(),
          title: agent?.title || (isInbox ? 'Lobe AI' : t('defaultSession')),
        };
      })}
    />
  );
});

interface BriefCardProps {
  brief: BriefItem;
}

const BriefCard = memo<BriefCardProps>(({ brief }) => {
  return (
    <Block
      className={styles.card}
      gap={12}
      padding={12}
      style={{ borderRadius: cssVar.borderRadiusLG }}
      variant={'outlined'}
    >
      <Flexbox horizontal align={'center'} gap={16} justify={'space-between'}>
        <Flexbox horizontal align={'center'} gap={8} style={{ overflow: 'hidden' }}>
          <BriefIcon type={brief.type} />
          <Text ellipsis fontSize={16} style={{ flex: 1 }} weight={500}>
            {brief.title}
          </Text>
          <Time date={brief.createdAt} />
        </Flexbox>
        {brief.agents.length > 0 && <AgentAvatars agents={brief.agents} />}
      </Flexbox>
      <BriefCardSummary summary={brief.summary} />
      <BriefCardActions
        briefId={brief.id}
        briefType={brief.type}
        resolvedAction={brief.resolvedAction}
        taskId={brief.taskId}
      />
    </Block>
  );
});

export default BriefCard;

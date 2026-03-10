import { Avatar, Block, Button, Center, Flexbox, Text } from '@lobehub/ui';
import { HandIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { DEFAULT_AVATAR, DEFAULT_INBOX_AVATAR } from '@/const/meta';
import GroupAvatar from '@/features/GroupAvatar';
import { type SharedTopicData } from '@/types/topic';

interface ActionBarProps {
  data: SharedTopicData;
}

const ActionBar = memo<ActionBarProps>(({ data }) => {
  const { t } = useTranslation('chat');
  const isGroup = !!data?.groupId;
  const isInboxAgent = !isGroup && data?.agentMeta?.slug === 'inbox';
  const agentOrGroupTitle =
    data?.groupMeta?.title || (isInboxAgent ? 'LobeAI' : data?.agentMeta?.title);
  const agentMarketIdentifier = data?.agentMeta?.marketIdentifier;

  // Build group avatars for GroupAvatar component
  const groupAvatars = useMemo(() => {
    if (!isGroup || !data?.groupMeta?.members) return [];
    return data.groupMeta.members.map((member) => ({
      avatar: member.avatar || DEFAULT_AVATAR,
      backgroundColor: member.backgroundColor || undefined,
    }));
  }, [isGroup, data?.groupMeta?.members]);

  const renderAgentOrGroupAvatar = () => {
    // For group: use GroupAvatar with members
    if (isGroup && groupAvatars.length > 0) {
      return <GroupAvatar avatars={groupAvatars} size={28} />;
    }

    // For inbox agent: skip avatar as it's the same as product icon
    if (isInboxAgent) {
      return <Avatar avatar={DEFAULT_INBOX_AVATAR} size={28} />;
    }

    // For agent: use single Avatar
    if (data?.agentMeta?.avatar) {
      return (
        <Avatar
          avatar={data.agentMeta.avatar}
          background={data.agentMeta.backgroundColor || undefined}
          size={28}
        />
      );
    }

    return null;
  };

  const renderAgentOrGroupTitle = () => {
    if (!agentOrGroupTitle) return null;

    return (
      <Text ellipsis weight={500}>
        {agentOrGroupTitle}
      </Text>
    );
  };

  const showActions = agentMarketIdentifier && !data?.groupMeta?.title;

  return (
    <Center>
      <Block
        horizontal
        shadow
        align="center"
        gap={16}
        justify={'space-between'}
        paddingBlock={8}
        paddingInline={'12px 8px'}
        variant={'outlined'}
        style={{
          borderRadius: 48,
          boxShadow: '0 2px 12px -4px rgba(0, 0, 0, 0.1)',
          maxWidth: 960,
        }}
      >
        <Flexbox horizontal align="center" gap={8}>
          {renderAgentOrGroupAvatar()}
          {renderAgentOrGroupTitle()}
        </Flexbox>
        <Flexbox horizontal align="center" gap={8}>
          <Link to={`/community/agent`}>
            <Button shape={'round'} variant={'filled'}>
              {t('sharePage.actions.findMord')}
            </Button>
          </Link>
          {showActions && (
            <Link to={`/community/agent/${agentMarketIdentifier}`}>
              <Button icon={HandIcon} shape={'round'} type={'primary'}>
                {t('sharePage.actions.tryItYourself')}
              </Button>
            </Link>
          )}
        </Flexbox>
      </Block>
    </Center>
  );
});

export default ActionBar;

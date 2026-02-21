import { Avatar, Block, Center, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { memo, useMemo } from 'react';

import Time from '@/app/[variants]/(main)/home/features/components/Time';
import { RECENT_BLOCK_SIZE } from '@/app/[variants]/(main)/home/features/const';
import { DEFAULT_AVATAR } from '@/const/meta';
import GroupAvatar from '@/features/GroupAvatar';
import { type RecentTopic } from '@/types/topic';

const ReactTopicItem = memo<RecentTopic>(({ title, updatedAt, agent, group, type }) => {
  const isGroup = type === 'group';

  // For group topics, get the first member's background for blur effect
  const blurBackground = isGroup ? group?.members?.[0]?.backgroundColor : agent?.backgroundColor;

  // Build group avatars for GroupAvatar component
  const groupAvatars = useMemo(() => {
    if (!isGroup || !group?.members) return [];
    return group.members.map((member) => ({
      avatar: member.avatar || DEFAULT_AVATAR,
      background: member.backgroundColor || undefined,
      style: { borderRadius: 3 },
    }));
  }, [isGroup, group?.members]);

  // Display title - group title or agent title
  const displayTitle = isGroup ? group?.title : agent?.title;

  return (
    <Block
      clickable
      flex={'none'}
      height={RECENT_BLOCK_SIZE.TOPIC.HEIGHT}
      variant={'outlined'}
      width={RECENT_BLOCK_SIZE.TOPIC.WIDTH}
      style={{
        borderRadius: cssVar.borderRadiusLG,
        overflow: 'hidden',
      }}
    >
      <Center
        flex={'none'}
        height={44}
        style={{
          background: cssVar.colorFillTertiary,
          overflow: 'hidden',
        }}
      >
        <Avatar
          emojiScaleWithBackground
          background={blurBackground || undefined}
          shape={'square'}
          size={200}
          avatar={
            isGroup
              ? group?.members?.[0]?.avatar || DEFAULT_AVATAR
              : agent?.avatar || DEFAULT_AVATAR
          }
          style={{
            filter: 'blur(100px)',
          }}
        />
      </Center>
      <Flexbox flex={1} gap={6} justify={'space-between'} padding={12}>
        <Flexbox
          gap={6}
          style={{
            marginTop: -28,
          }}
        >
          {isGroup ? (
            <GroupAvatar
              avatars={groupAvatars}
              size={30}
              style={{
                background: cssVar.colorBgLayout,
              }}
            />
          ) : (
            <Avatar
              emojiScaleWithBackground
              avatar={agent?.avatar || DEFAULT_AVATAR}
              background={agent?.backgroundColor || undefined}
              shape={'square'}
              size={30}
              title={agent?.title || undefined}
            />
          )}
          <Text ellipsis={{ rows: 2 }} style={{ lineHeight: 1.4 }} weight={500}>
            {title}
          </Text>
        </Flexbox>
        <Flexbox horizontal align={'center'} gap={8}>
          <Time date={updatedAt} />
          <Text ellipsis fontSize={12} type={'secondary'}>
            {displayTitle}
          </Text>
        </Flexbox>
      </Flexbox>
    </Block>
  );
});

export default ReactTopicItem;

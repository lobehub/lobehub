import { Avatar } from '@lobehub/ui';
import { memo, useMemo } from 'react';

import { DEFAULT_AVATAR, DEFAULT_INBOX_AVATAR } from '@/const/meta';
import GroupAvatar from '@/features/GroupAvatar';
import { type SharedTopicData } from '@/types/topic';

interface TopicAvatarProps {
  data: SharedTopicData;
  size?: number;
}

const TopicAvatar = memo<TopicAvatarProps>(({ data, size = 28 }) => {
  const isGroup = !!data.groupId;
  const isInboxAgent = !isGroup && data.agentMeta?.slug === 'inbox';

  const groupAvatars = useMemo(() => {
    if (!isGroup || !data.groupMeta?.members) return [];
    return data.groupMeta.members.map((member) => ({
      avatar: member.avatar || DEFAULT_AVATAR,
      backgroundColor: member.backgroundColor || undefined,
    }));
  }, [isGroup, data.groupMeta?.members]);

  if (isGroup && groupAvatars.length > 0) return <GroupAvatar avatars={groupAvatars} size={size} />;

  if (isInboxAgent) return <Avatar avatar={DEFAULT_INBOX_AVATAR} size={size} />;

  if (data.agentMeta?.avatar)
    return (
      <Avatar
        avatar={data.agentMeta.avatar}
        background={data.agentMeta.backgroundColor || undefined}
        size={size}
      />
    );

  return null;
});

TopicAvatar.displayName = 'TopicAvatar';

export default TopicAvatar;

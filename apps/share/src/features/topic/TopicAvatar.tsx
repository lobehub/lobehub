import { agentDisplayName } from '@lobechat/types';
import { Avatar } from '@lobehub/ui';
import { memo, useMemo } from 'react';

import AgentAvatar from '@/components/AgentAvatar';
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

  if (isGroup) return null;

  return (
    <AgentAvatar
      agentId={data.agentId}
      avatar={data.agentMeta?.avatar}
      background={data.agentMeta?.backgroundColor || undefined}
      name={agentDisplayName(data.agentMeta) || undefined}
      shape={'circle'}
      size={size}
    />
  );
});

TopicAvatar.displayName = 'TopicAvatar';

export default TopicAvatar;

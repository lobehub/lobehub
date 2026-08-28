import { DEFAULT_AVATAR } from '@lobechat/const';
import { memo } from 'react';

import Avatar from '@/components/Avatar';

interface AgentAvatarProps {
  avatar?: string;
  avatarBackground?: string;
  title?: string;
}

const AgentAvatar = memo<AgentAvatarProps>(({ avatar, avatarBackground, title }) => {
  return (
    <Avatar
      emojiScaleWithBackground
      avatar={avatar || DEFAULT_AVATAR}
      background={avatarBackground}
      name={title}
      shape={'square'}
      size={22}
    />
  );
});

export default AgentAvatar;

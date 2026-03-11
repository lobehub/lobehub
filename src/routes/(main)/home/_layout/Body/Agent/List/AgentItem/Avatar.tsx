import { DEFAULT_AVATAR } from '@lobechat/const';
import { Avatar } from '@lobehub/ui';
import { memo } from 'react';

interface AgentAvatarProps {
  avatar?: string;
  avatarBackground?: string;
}

const AgentAvatar = memo<AgentAvatarProps>(({ avatar, avatarBackground }) => {
  return (
    <Avatar
      emojiScaleWithBackground
      avatar={avatar || DEFAULT_AVATAR}
      background={avatarBackground}
      shape={'square'}
      size={22}
    />
  );
});

export default AgentAvatar;

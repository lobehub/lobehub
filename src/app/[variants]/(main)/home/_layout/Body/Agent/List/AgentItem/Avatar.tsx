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
      avatar={avatar || DEFAULT_AVATAR}
      background={avatarBackground}
      emojiScaleWithBackground
      shape={'square'}
      size={22}
    />
  );
});

export default AgentAvatar;

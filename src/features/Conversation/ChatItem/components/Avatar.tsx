import { agentDisplayName } from '@lobechat/types';
import { type CSSProperties, type MouseEventHandler } from 'react';
import { memo } from 'react';

import A from '@/components/Avatar';

import { type ChatItemProps } from '../type';

export interface AvatarProps {
  alt?: string;
  avatar: ChatItemProps['avatar'];
  loading?: boolean;
  onClick?: ChatItemProps['onAvatarClick'] | MouseEventHandler<HTMLDivElement>;
  size?: number;
  style?: CSSProperties;
  unoptimized?: boolean;
}

const Avatar = memo<AvatarProps>(
  ({ loading, avatar, unoptimized, onClick, size = 28, style, alt }) => {
    const displayName = agentDisplayName(avatar);

    return (
      <A
        alt={alt || displayName}
        animation={loading}
        avatar={avatar.avatar}
        background={avatar.backgroundColor}
        name={displayName}
        shape={'square'}
        size={size}
        style={style}
        title={displayName}
        unoptimized={unoptimized}
        onClick={onClick}
      />
    );
  },
);

export default Avatar;

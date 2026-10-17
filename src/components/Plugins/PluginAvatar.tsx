import { MCP } from '@lobehub/icons';
import { Avatar } from '@lobehub/ui';
import { type CSSProperties } from 'react';
import { memo } from 'react';

interface PluginAvatarProps {
  alt?: string;
  avatar?: string;
  size?: number;
  style?: CSSProperties;
}

const PluginAvatar = memo<PluginAvatarProps>(({ avatar, style, size = 40, alt }) => {
  return avatar === 'MCP_AVATAR' ? (
    <MCP.Avatar
      className={'ant-avatar'}
      shape={'square'}
      size={size}
      style={{ flex: 'none', overflow: 'hidden', ...style }}
    />
  ) : (
    <Avatar
      alt={alt}
      avatar={avatar}
      shape={'square'}
      size={size}
      style={{ flex: 'none', overflow: 'hidden', ...style }}
    />
  );
});

export default PluginAvatar;

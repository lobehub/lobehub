import { agentDisplayName } from '@lobechat/types';
import { type CSSProperties, type MouseEventHandler } from 'react';
import { memo, useState } from 'react';

import AgentAvatar from '@/components/AgentAvatar';
import A from '@/components/Avatar';

import { contextSelectors, useConversationStore } from '../../store';
import { type ChatItemProps } from '../type';

export interface AvatarProps {
  /** Agent message: render an agent avatar seeded by this id (empty → conversation agent). */
  agentId?: ChatItemProps['agentId'];
  alt?: string;
  avatar: ChatItemProps['avatar'];
  loading?: boolean;
  onClick?: ChatItemProps['onAvatarClick'] | MouseEventHandler<HTMLDivElement>;
  shape?: 'circle' | 'square';
  size?: number;
  style?: CSSProperties;
  unoptimized?: boolean;
}

const Avatar = memo<AvatarProps>(
  ({ agentId, loading, avatar, unoptimized, onClick, shape = 'square', size = 28, style, alt }) => {
    const displayName = agentDisplayName(avatar);
    const contextAgentId = useConversationStore(contextSelectors.agentId);
    // A feed holds many of these, so only a generating or hovered character animates.
    const [hovered, setHovered] = useState(false);

    // A custom node (rather than an emoji or image URL) is rendered as given.
    const agentAvatar =
      agentId !== undefined && (!avatar.avatar || typeof avatar.avatar === 'string')
        ? (avatar.avatar as string | undefined)
        : null;

    if (agentAvatar !== null)
      return (
        <AgentAvatar
          agentId={agentId || contextAgentId}
          alt={alt || displayName}
          animated={!!loading || hovered}
          animation={loading}
          avatar={agentAvatar}
          background={avatar.backgroundColor}
          followPointer={hovered}
          name={displayName}
          shape={shape}
          size={size}
          state={loading ? 'working' : undefined}
          style={style}
          title={displayName}
          unoptimized={unoptimized}
          onClick={onClick}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        />
      );

    return (
      <A
        alt={alt || displayName}
        animation={loading}
        avatar={avatar.avatar}
        background={avatar.backgroundColor}
        name={displayName}
        shape={shape}
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

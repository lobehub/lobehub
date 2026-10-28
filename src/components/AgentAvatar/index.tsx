'use client';

import { AgentAvatar as GeneratedAgentAvatar, type AgentAvatarState } from '@lobehub/ui';
import { memo, type MouseEventHandler } from 'react';

import Avatar, { type AvatarProps } from '@/components/Avatar';

import { resolveAgentAvatar } from './resolve';

export { isDefaultAgentAvatar } from './resolve';

export interface AgentAvatarProps extends Omit<AvatarProps, 'avatar' | 'brokenFallback' | 'name'> {
  /**
   * Stable seed of the generated character. Pass the agent id so a rename does
   * not reshuffle it; falls back to the name.
   */
  agentId?: string | null;
  /** Play the `state` animation of the generated character. */
  animated?: boolean;
  /** Emoji or image URL. Empty (or the legacy default image) draws the generated character. */
  avatar?: string | null;
  /** Display name: labels the avatar and seeds the character when `agentId` is absent. */
  name?: string | null;
  /** Activity state of the generated character. */
  state?: AgentAvatarState;
}

/**
 * An agent's avatar. Without an emoji or image of its own — or when the image
 * fails to load — it draws the character `@lobehub/ui` generates from the agent
 * id, so agents read apart from people (pixel avatars) and projects (gradients).
 */
const AgentAvatar = memo<AgentAvatarProps>(
  ({
    agentId,
    animated,
    avatar,
    background,
    className,
    name,
    onClick,
    shape = 'square',
    size = 24,
    state,
    style,
    title,
    ...rest
  }) => {
    const resolved = resolveAgentAvatar({ agentId, avatar, name, title });

    const generated = (
      <GeneratedAgentAvatar
        animated={animated}
        className={className}
        name={resolved.label}
        seed={resolved.seed}
        size={size}
        state={state}
        style={{ flex: 'none', ...style }}
        onClick={onClick as unknown as MouseEventHandler<SVGSVGElement>}
      />
    );

    if (resolved.kind === 'generated') return generated;

    return (
      <Avatar
        emojiScaleWithBackground
        {...rest}
        avatar={resolved.avatar}
        background={background}
        brokenFallback={generated}
        className={className}
        name={resolved.label}
        shape={shape}
        size={size}
        style={style}
        title={title}
        onClick={onClick}
      />
    );
  },
);

AgentAvatar.displayName = 'AgentAvatar';

export default AgentAvatar;

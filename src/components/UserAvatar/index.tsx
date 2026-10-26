'use client';

import { memo } from 'react';

import Avatar, { type AvatarProps } from '@/components/Avatar';

export interface UserAvatarProps extends Omit<AvatarProps, 'avatar' | 'name'> {
  /** Profile image URL (or emoji). Empty draws the generated fallback. */
  avatar?: string | null;
  /** Display name: seeds the generated fallback and labels the image. */
  name?: string | null;
}

/**
 * A person's avatar. Without a profile image it draws the pixel-style avatar
 * `@lobehub/ui` generates from the name, so people read apart from agents and
 * projects, whose image-less fallback is the smooth gradient.
 */
const UserAvatar = memo<UserAvatarProps>(
  ({ avatar, fallbackVariant = 'pixel', name, title, ...rest }) => (
    <Avatar
      {...rest}
      avatar={avatar || undefined}
      fallbackVariant={fallbackVariant}
      name={name || undefined}
      title={title ?? (name || undefined)}
    />
  ),
);

UserAvatar.displayName = 'UserAvatar';

export default UserAvatar;

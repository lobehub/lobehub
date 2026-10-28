'use client';

import { memo } from 'react';

import Avatar, { type AvatarProps } from '@/components/Avatar';

export interface WorkspaceAvatarProps extends Omit<AvatarProps, 'avatar' | 'name'> {
  /** The workspace's own logo (image URL or emoji). Empty draws the generated fallback. */
  avatar?: string | null;
  /** Workspace name: seeds the generated fallback and labels the image. */
  name?: string | null;
}

/**
 * An organization's avatar. Without a logo it draws the bauhaus-style avatar
 * `@lobehub/ui` generates from the name, so workspaces read apart from people
 * (pixel) and from agents and projects (gradient), and the same name always
 * draws the same mark.
 */
const WorkspaceAvatar = memo<WorkspaceAvatarProps>(
  ({ avatar, fallbackVariant = 'bauhaus', name, shape = 'square', title, ...rest }) => (
    <Avatar
      {...rest}
      avatar={avatar || undefined}
      fallbackVariant={fallbackVariant}
      name={name || undefined}
      shape={shape}
      title={title ?? (name || undefined)}
    />
  ),
);

WorkspaceAvatar.displayName = 'WorkspaceAvatar';

export default WorkspaceAvatar;

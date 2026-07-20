'use client';

import { Avatar, Tooltip } from '@lobehub/ui';
import { memo } from 'react';

import { useAuthorInfo } from '@/business/client/hooks/useAuthorInfo';

interface TopicCreatorAvatarProps {
  /** Size of the avatar in px. */
  size?: number;
  /** Creator (author) of the topic. */
  userId?: string;
}

/**
 * In a workspace the topic list mixes topics from every member. Show each
 * topic's creator avatar as a trailing indicator — including the current user's
 * own topics — so the list reads as a shared space.
 *
 * `useAuthorInfo` is a business slot that resolves the creator profile from the
 * *active workspace* members (cloud) or a no-op (open-source). It returns
 * `undefined` when there is no active workspace, so this renders nothing in
 * personal mode.
 */
const TopicCreatorAvatar = memo<TopicCreatorAvatarProps>(({ userId, size = 16 }) => {
  const author = useAuthorInfo(userId);

  if (!author) return null;

  return (
    <Tooltip title={author.fullName}>
      <Avatar
        avatar={author.avatar ?? undefined}
        size={size}
        style={{ flex: 'none' }}
        title={author.fullName ?? undefined}
      />
    </Tooltip>
  );
});

TopicCreatorAvatar.displayName = 'TopicCreatorAvatar';

export default TopicCreatorAvatar;

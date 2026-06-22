'use client';

import { Avatar, Tooltip } from '@lobehub/ui';
import { memo } from 'react';

import { useAuthorInfo } from '@/business/client/hooks/useAuthorInfo';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

interface TopicCreatorAvatarProps {
  /** Size of the avatar in px. */
  size?: number;
  /** Creator (author) of the topic. */
  userId?: string;
}

/**
 * In a workspace the topic list mixes topics from every member. Show the
 * creator's avatar for topics authored by someone *other* than the current
 * user so the list reads as a shared space.
 *
 * Renders nothing for own / personal topics: `useAuthorInfo` is a business slot
 * that resolves to a no-op (open-source) or the active workspace member profile
 * (cloud), and we pass `undefined` for the current user so it never resolves.
 */
const TopicCreatorAvatar = memo<TopicCreatorAvatarProps>(({ userId, size = 16 }) => {
  const currentUserId = useUserStore(userProfileSelectors.userId);
  const isOther = !!userId && userId !== currentUserId;
  const author = useAuthorInfo(isOther ? userId : undefined);

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

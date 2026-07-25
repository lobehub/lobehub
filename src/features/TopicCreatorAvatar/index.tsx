'use client';

import { Avatar, Tooltip } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { memo, type ReactNode } from 'react';

import { useAuthorInfo } from '@/business/client/hooks/useAuthorInfo';

/**
 * Resolves a topic creator's profile from the *active workspace* members.
 * `useAuthorInfo` is a business slot: cloud resolves the member profile, the
 * open-source build is a no-op — and it returns `undefined` without an active
 * workspace, so all creator-avatar UI disappears in personal mode.
 */
export const useTopicCreator = (userId?: string) => useAuthorInfo(userId);

interface TopicCreatorAvatarProps {
  /**
   * Optional mini node (execution status, bot platform icon, PR marker, …)
   * overlaid at the avatar's bottom-right corner. The creator stays the
   * primary visual; the row's own icon shrinks into the badge.
   */
  corner?: ReactNode;
  /** Size of the avatar in px. */
  size?: number;
  /** Creator (author) of the topic. */
  userId?: string;
}

/**
 * Round creator avatar for a workspace topic row's leading icon slot — it
 * replaces the default `#` placeholder so the shared list reads like a
 * conversation list. Renders nothing when the creator doesn't resolve
 * (personal mode / unknown member).
 */
const TopicCreatorAvatar = memo<TopicCreatorAvatarProps>(({ userId, size = 20, corner }) => {
  const author = useTopicCreator(userId);

  if (!author) return null;

  const avatar = (
    <Tooltip title={author.fullName}>
      <Avatar
        avatar={author.avatar ?? undefined}
        shape={'circle'}
        size={size}
        style={{ flex: 'none' }}
        title={author.fullName ?? undefined}
      />
    </Tooltip>
  );

  if (!corner) return avatar;

  return (
    <span style={{ display: 'inline-flex', lineHeight: 0, position: 'relative' }}>
      {avatar}
      <span
        style={{
          alignItems: 'center',
          // Solid panel background so the badge glyph reads cleanly instead of
          // colliding with the avatar underneath; the ring blends it into the
          // sidebar like a Slack/Discord presence badge.
          background: cssVar.colorBgLayout,
          borderRadius: '50%',
          bottom: -4,
          boxShadow: `0 0 0 1.5px ${cssVar.colorBgLayout}`,
          display: 'inline-flex',
          height: 13,
          justifyContent: 'center',
          lineHeight: 0,
          position: 'absolute',
          right: -4,
          width: 13,
        }}
      >
        <span
          style={{
            alignItems: 'center',
            display: 'inline-flex',
            justifyContent: 'center',
            transform: 'scale(0.75)',
            transformOrigin: 'center',
          }}
        >
          {corner}
        </span>
      </span>
    </span>
  );
});

TopicCreatorAvatar.displayName = 'TopicCreatorAvatar';

export default TopicCreatorAvatar;

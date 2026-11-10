'use client';

import type { BotSenderMetadata } from '@lobechat/types';
import { cssVar, Tooltip } from '@lobehub/ui';
import { memo, type ReactNode } from 'react';

import { useAuthorInfo } from '@/business/client/hooks/useAuthorInfo';
import { useHasActiveWorkspace } from '@/business/client/hooks/useHasActiveWorkspace';
import UserAvatar from '@/components/UserAvatar';

/**
 * Prefer the bot-channel initiator over the account that owns the bot.
 * Ordinary topics resolve their creator from active workspace members; the
 * open-source business slot returns undefined for those member profiles.
 * Creator identity is a workspace-only cue, so personal mode ignores the bot
 * initiator too and the row keeps its own platform icon.
 */
export const useTopicCreator = (userId?: string, botCreator?: BotSenderMetadata | null) => {
  const author = useAuthorInfo(userId);
  const hasActiveWorkspace = useHasActiveWorkspace();
  return botCreator && hasActiveWorkspace
    ? {
        avatar: botCreator.avatar,
        fullName: botCreator.fullName || botCreator.username || botCreator.id,
      }
    : author;
};

interface TopicCreatorAvatarProps {
  botCreator?: BotSenderMetadata | null;
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
 * Round creator avatar for a topic row, with an optional status/platform badge.
 * Renders nothing when neither a bot initiator nor a workspace member resolves.
 */
const TopicCreatorAvatar = memo<TopicCreatorAvatarProps>(
  ({ userId, size = 20, corner, botCreator }) => {
    const author = useTopicCreator(userId, botCreator);

    if (!author) return null;

    const avatar = (
      <Tooltip title={author.fullName}>
        <UserAvatar
          avatar={author.avatar}
          name={author.fullName}
          shape={'circle'}
          size={size}
          style={{ flex: 'none' }}
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
  },
);

TopicCreatorAvatar.displayName = 'TopicCreatorAvatar';

export default TopicCreatorAvatar;

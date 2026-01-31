'use client';

import type { EmojiReaction } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { memo } from 'react';

const useStyles = createStyles(({ css, token }) => ({
  active: css`
    border: 1px solid ${token.colorPrimary};
    background: ${token.colorPrimaryBg};
  `,
  container: css`
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-block-start: 8px;
  `,
  count: css`
    font-size: 12px;
    color: ${token.colorTextSecondary};
  `,
  reactionTag: css`
    cursor: pointer;

    display: inline-flex;
    gap: 4px;
    align-items: center;

    padding-block: 2px;
    padding-inline: 8px;
    border: 1px solid transparent;
    border-radius: ${token.borderRadius}px;

    font-size: 14px;

    background: ${token.colorFillSecondary};

    transition: all 0.2s;

    &:hover {
      background: ${token.colorFillTertiary};
    }
  `,
}));

interface ReactionDisplayProps {
  /**
   * Whether the current user has reacted (used for single-user mode)
   */
  isActive?: (emoji: string) => boolean;
  /**
   * Callback when a reaction is clicked
   */
  onReactionClick?: (emoji: string) => void;
  /**
   * The reactions to display
   */
  reactions: EmojiReaction[];
}

const ReactionDisplay = memo<ReactionDisplayProps>(({ reactions, onReactionClick, isActive }) => {
  const { styles, cx } = useStyles();

  if (reactions.length === 0) return null;

  return (
    <Flexbox className={styles.container} horizontal>
      {reactions.map((reaction) => (
        <div
          className={cx(styles.reactionTag, isActive?.(reaction.emoji) && styles.active)}
          key={reaction.emoji}
          onClick={() => onReactionClick?.(reaction.emoji)}
        >
          <span>{reaction.emoji}</span>
          {reaction.count > 1 && <span className={styles.count}>{reaction.count}</span>}
        </div>
      ))}
    </Flexbox>
  );
});

ReactionDisplay.displayName = 'ReactionDisplay';

export default ReactionDisplay;

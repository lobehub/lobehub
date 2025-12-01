'use client';

import type { EmojiReaction } from '@lobechat/types';
import { createStyles } from 'antd-style';
import { memo } from 'react';
import { Flexbox } from 'react-layout-kit';

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
  reactions: Record<string, EmojiReaction>;
}

const ReactionDisplay = memo<ReactionDisplayProps>(({ reactions, onReactionClick, isActive }) => {
  const { styles, cx } = useStyles();

  const reactionEntries = Object.entries(reactions);

  if (reactionEntries.length === 0) return null;

  return (
    <Flexbox className={styles.container} horizontal>
      {reactionEntries.map(([emoji, data]) => (
        <div
          className={cx(styles.reactionTag, isActive?.(emoji) && styles.active)}
          key={emoji}
          onClick={() => onReactionClick?.(emoji)}
        >
          <span>{emoji}</span>
          {data.count > 1 && <span className={styles.count}>{data.count}</span>}
        </div>
      ))}
    </Flexbox>
  );
});

ReactionDisplay.displayName = 'ReactionDisplay';

export default ReactionDisplay;

'use client';

import type { EmojiReaction } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { memo } from 'react';

import ReactionPicker from './ReactionPicker';

const useStyles = createStyles(({ css, token }) => ({
  active: css`
    background: ${token.colorFillTertiary};
  `,
  container: css`
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
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

    height: 28px;
    padding-block: 0;
    padding-inline: 10px;
    border-radius: 14px;

    font-size: 14px;
    line-height: 1;

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
   * The message ID for adding reactions via the inline picker
   */
  messageId?: string;
  /**
   * Callback when a reaction is clicked
   */
  onReactionClick?: (emoji: string) => void;
  /**
   * The reactions to display
   */
  reactions: EmojiReaction[];
}

const ReactionDisplay = memo<ReactionDisplayProps>(
  ({ reactions, onReactionClick, messageId, isActive }) => {
    const { styles, cx } = useStyles();

    if (reactions.length === 0) return null;

    return (
      <Flexbox align={'center'} className={styles.container} horizontal>
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
        {messageId && <ReactionPicker messageId={messageId} />}
      </Flexbox>
    );
  },
);

ReactionDisplay.displayName = 'ReactionDisplay';

export default ReactionDisplay;

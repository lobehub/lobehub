'use client';

import type { EmojiReaction } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import { usePermission } from '@/hooks/usePermission';

const styles = stylex.create({
  active: { backgroundColor: cssVar.colorFillTertiary, backgroundImage: 'none' },
  container: { display: 'flex', flexWrap: 'wrap', gap: '4px' },
  count: { fontSize: '12px', color: cssVar.colorTextSecondary },
  reactionTag: {
    cursor: 'pointer',
    display: 'inline-flex',
    gap: '4px',
    alignItems: 'center',
    height: '28px',
    paddingBlock: '0',
    paddingInline: '10px',
    borderRadius: '14px',
    fontSize: '14px',
    lineHeight: 1,
    backgroundColor: { 'default': cssVar.colorFillSecondary, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': 'none', ':hover': 'none' },
    transition: 'all 0.2s',
  },
});

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
  const { allowed: canEdit } = usePermission('edit_own_content');

  if (reactions.length === 0) return null;

  return (
    <Flexbox horizontal align={'center'} className={stylex.props(styles.container).className}>
      {reactions.map((reaction) => (
        <div
          key={reaction.emoji}
          style={{ cursor: canEdit ? undefined : 'default' }}
          className={
            stylex.props(styles.reactionTag, isActive?.(reaction.emoji) && styles.active).className
          }
          onClick={canEdit ? () => onReactionClick?.(reaction.emoji) : undefined}
        >
          <span>{reaction.emoji}</span>
          {reaction.count > 1 && <span {...stylex.props(styles.count)}>{reaction.count}</span>}
        </div>
      ))}
    </Flexbox>
  );
});

ReactionDisplay.displayName = 'ReactionDisplay';

export default ReactionDisplay;

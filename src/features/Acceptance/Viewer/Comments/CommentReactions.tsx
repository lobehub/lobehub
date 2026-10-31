'use client';

import data from '@emoji-mart/data';
import Picker from '@emoji-mart/react';
import type { AcceptanceCommentReaction } from '@lobechat/types';
import { Flexbox, Icon, Popover, toast, Tooltip, useTheme } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { PlusIcon, SmilePlus } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useGlobalStore } from '@/store/global';
import { globalGeneralSelectors } from '@/store/global/selectors';
import { sx } from '@/styles/sx';

/** The ten GitHub offers, in GitHub's order — the shortcut covers nearly every click. */
const QUICK_REACTIONS = ['👍', '👎', '😄', '🎉', '😕', '❤️', '🚀', '👀', '🙏', '🔥'];

const styles = stylex.create({
  /** The reaction row closes the comment, so it hugs the body's bottom edge. */
  bar: {
    paddingBlockStart: '10px',
  },
  chip: {
    cursor: 'pointer',
    display: 'inline-flex',
    gap: '5px',
    alignItems: 'center',
    height: '24px',
    paddingBlock: 0,
    paddingInline: '8px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: { 'default': cssVar.colorBorderSecondary, ':hover': cssVar.colorBorder },
    borderRadius: '999px',
    fontSize: '13px',
    lineHeight: 1,
    backgroundColor: cssVar.colorFillQuaternary,
  },
  /** Yours reads as pressed: same shape, the accent border and count. */
  chipMine: {
    // Hover keeps the neutral border, as it did when `.chip:hover` outranked this rule.
    borderColor: { 'default': cssVar.colorInfoBorder, ':hover': cssVar.colorBorder },
    color: cssVar.colorInfoText,
    backgroundColor: `color-mix(in srgb, ${cssVar.colorInfo} 10%, transparent)`,
  },
  count: {
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
  },
  emojiButton: {
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '30px',
    height: '30px',
    borderRadius: cssVar.borderRadius,
    fontSize: '17px',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillSecondary },
  },
  moreButton: {
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '30px',
    height: '30px',
    borderRadius: cssVar.borderRadius,
    color: { 'default': cssVar.colorTextTertiary, ':hover': cssVar.colorText },
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillSecondary },
  },
  /**
   * The add button stands on its own rather than waiting for a hover: reacting
   * is the cheapest way to answer a delivery, and an affordance you have to
   * find by sweeping the mouse is one most readers never find at all. Quiet by
   * default, it darkens under the cursor.
   */
  trigger: {
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '24px',
    height: '24px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: '999px',
    color: { 'default': cssVar.colorTextTertiary, ':hover': cssVar.colorText },
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillQuaternary },
    transition: `color ${cssVar.motionDurationFast}`,
  },
  triggerOpen: {
    color: cssVar.colorText,
    backgroundColor: cssVar.colorFillQuaternary,
  },
});

interface CommentReactionsProps {
  /** Absent for a reader who may not write — the chips stay, the button goes. */
  onReact?: (emoji: string, on: boolean) => Promise<void>;
  reactions: AcceptanceCommentReaction[];
}

/**
 * Agreement without another message. One row of chips under the words, plus the
 * add button GitHub puts there: on a review page most replies are "yes, this
 * one" or "no", and spending a whole timeline entry on that buries the remarks
 * that actually say something.
 */
const CommentReactions = memo<CommentReactionsProps>(({ onReact, reactions }) => {
  const { t } = useTranslation('verify');
  const theme = useTheme();
  const locale = useGlobalStore(globalGeneralSelectors.currentLanguage);
  const [open, setOpen] = useState(false);
  const [full, setFull] = useState(false);

  if (reactions.length === 0 && !onReact) return null;

  const fire = async (emoji: string, on: boolean) => {
    try {
      await onReact?.(emoji, on);
    } catch (cause) {
      console.error('[acceptance:comments]', cause);
      toast.error(t('acceptance.comments.updateFailed'));
    }
  };

  const pick = (emoji: string) => {
    setOpen(false);
    setFull(false);
    void fire(emoji, true);
  };

  const picker = full ? (
    <Picker
      data={data}
      locale={locale?.split('-')[0] || 'en'}
      previewPosition={'none'}
      skinTonePosition={'none'}
      theme={theme.appearance === 'dark' ? 'dark' : 'light'}
      onEmojiSelect={(emoji: { native: string }) => pick(emoji.native)}
    />
  ) : (
    <Flexbox horizontal gap={2} style={{ padding: 4 }} wrap={'wrap'}>
      {QUICK_REACTIONS.map((emoji) => (
        <div key={emoji} {...stylex.props(styles.emojiButton)} onClick={() => pick(emoji)}>
          {emoji}
        </div>
      ))}
      <div {...stylex.props(styles.moreButton)} onClick={() => setFull(true)}>
        <Icon icon={PlusIcon} size={15} />
      </div>
    </Flexbox>
  );

  // The button leads and the emoji follow: it is the one fixed thing in this
  // row, so it stays where the reader last clicked it instead of sliding right
  // by one chip every time somebody reacts.
  return (
    <Flexbox horizontal align={'center'} gap={6} wrap={'wrap'} {...stylex.props(styles.bar)}>
      {onReact && (
        <Popover
          content={picker}
          open={open}
          placement={'topLeft'}
          styles={{ content: { padding: 0 } }}
          trigger={'click'}
          onOpenChange={(visible) => {
            setOpen(visible);
            if (!visible) setFull(false);
          }}
        >
          <span
            data-comment-reaction-add
            {...stylex.props(styles.trigger, open && styles.triggerOpen)}
            title={t('acceptance.comments.addReaction')}
            {...(open ? { 'data-open': '' } : {})}
          >
            <Icon icon={SmilePlus} size={13} />
          </span>
        </Popover>
      )}
      {reactions.map((reaction) => (
        <Tooltip
          key={reaction.emoji}
          title={reaction.authorNames.length > 0 ? reaction.authorNames.join('、') : reaction.emoji}
        >
          <span
            {...sx(
              [styles.chip, reaction.mine && styles.chipMine],
              undefined,
              onReact ? undefined : { cursor: 'default' },
            )}
            onClick={onReact ? () => void fire(reaction.emoji, !reaction.mine) : undefined}
          >
            <span>{reaction.emoji}</span>
            <span {...stylex.props(styles.count)}>{reaction.count}</span>
          </span>
        </Tooltip>
      ))}
    </Flexbox>
  );
});

CommentReactions.displayName = 'AcceptanceCommentReactions';

export default CommentReactions;

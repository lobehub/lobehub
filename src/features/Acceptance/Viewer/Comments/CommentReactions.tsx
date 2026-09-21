'use client';

import data from '@emoji-mart/data';
import Picker from '@emoji-mart/react';
import type { AcceptanceCommentReaction } from '@lobechat/types';
import { Flexbox, Icon, Tooltip } from '@lobehub/ui';
import { Popover, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx, useTheme } from 'antd-style';
import { PlusIcon, SmilePlus } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useGlobalStore } from '@/store/global';
import { globalGeneralSelectors } from '@/store/global/selectors';

/** The ten GitHub offers, in GitHub's order — the shortcut covers nearly every click. */
const QUICK_REACTIONS = ['👍', '👎', '😄', '🎉', '😕', '❤️', '🚀', '👀', '🙏', '🔥'];

const styles = createStaticStyles(({ css }) => ({
  /** The reaction row closes the comment, so it hugs the body's bottom edge. */
  bar: css`
    padding-block-start: 10px;
  `,
  chip: css`
    cursor: pointer;

    display: inline-flex;
    gap: 5px;
    align-items: center;

    height: 24px;
    padding-block: 0;
    padding-inline: 8px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 999px;

    font-size: 13px;
    line-height: 1;

    background: ${cssVar.colorFillQuaternary};

    &:hover {
      border-color: ${cssVar.colorBorder};
    }
  `,
  /** Yours reads as pressed: same shape, the accent border and count. */
  chipMine: css`
    border-color: ${cssVar.colorInfoBorder};
    color: ${cssVar.colorInfoText};
    background: color-mix(in srgb, ${cssVar.colorInfo} 10%, transparent);
  `,
  count: css`
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
  emojiButton: css`
    cursor: pointer;

    display: flex;
    align-items: center;
    justify-content: center;

    width: 30px;
    height: 30px;
    border-radius: ${cssVar.borderRadius};

    font-size: 17px;

    &:hover {
      background: ${cssVar.colorFillSecondary};
    }
  `,
  moreButton: css`
    cursor: pointer;

    display: flex;
    align-items: center;
    justify-content: center;

    width: 30px;
    height: 30px;
    border-radius: ${cssVar.borderRadius};

    color: ${cssVar.colorTextTertiary};

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillSecondary};
    }
  `,
  /**
   * The add button stands on its own rather than waiting for a hover: reacting
   * is the cheapest way to answer a delivery, and an affordance you have to
   * find by sweeping the mouse is one most readers never find at all. Quiet by
   * default, it darkens under the cursor.
   */
  trigger: css`
    cursor: pointer;

    display: inline-flex;
    align-items: center;
    justify-content: center;

    width: 24px;
    height: 24px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 999px;

    color: ${cssVar.colorTextTertiary};

    transition: color ${cssVar.motionDurationFast};

    &:hover,
    &[data-open] {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillQuaternary};
    }
  `,
}));

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
        <div className={styles.emojiButton} key={emoji} onClick={() => pick(emoji)}>
          {emoji}
        </div>
      ))}
      <div className={styles.moreButton} onClick={() => setFull(true)}>
        <Icon icon={PlusIcon} size={15} />
      </div>
    </Flexbox>
  );

  // The button leads and the emoji follow: it is the one fixed thing in this
  // row, so it stays where the reader last clicked it instead of sliding right
  // by one chip every time somebody reacts.
  return (
    <Flexbox horizontal align={'center'} className={styles.bar} gap={6} wrap={'wrap'}>
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
            className={styles.trigger}
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
            className={cx(styles.chip, reaction.mine && styles.chipMine)}
            style={onReact ? undefined : { cursor: 'default' }}
            onClick={onReact ? () => void fire(reaction.emoji, !reaction.mine) : undefined}
          >
            <span>{reaction.emoji}</span>
            <span className={styles.count}>{reaction.count}</span>
          </span>
        </Tooltip>
      ))}
    </Flexbox>
  );
});

CommentReactions.displayName = 'AcceptanceCommentReactions';

export default CommentReactions;

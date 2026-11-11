'use client';

import { HotkeyEnum } from '@lobechat/const/hotkeys';
import { ActionIcon, Flexbox } from '@lobehub/ui';
import {
  ArchiveRestore,
  ChevronDown,
  ChevronUp,
  Forward,
  Mail,
  MailOpen,
  Reply,
  ReplyAll,
  Star,
  Trash2,
} from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useMailHotkeyHint } from './mailHotkeys';
import { identityStyles } from './styles';

export interface MailDetailToolbarProps {
  /** Why forwarding is unavailable; the button stays, disabled, so the ability is visible. */
  forwardDisabledReason?: string;
  hasNext: boolean;
  hasPrevious: boolean;
  onForward?: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onReply?: () => void;
  onReplyAll?: () => void;
  /** Only in the trash, where it takes the place of trashing. */
  onRestore?: () => void;
  onToggleRead?: () => void;
  onToggleStar?: () => void;
  onTrash?: () => void;
  /** Why replying is unavailable (cannot send, or nothing received to answer). */
  replyDisabledReason?: string;
  starred: boolean;
  unread: boolean;
}

/** What can be done to the open conversation, and the way to the ones around it. */
const MailDetailToolbar = memo<MailDetailToolbarProps>(
  ({
    forwardDisabledReason,
    hasNext,
    hasPrevious,
    onForward,
    onNext,
    onPrevious,
    onReply,
    onReplyAll,
    onRestore,
    replyDisabledReason,
    onToggleRead,
    onToggleStar,
    onTrash,
    starred,
    unread,
  }) => {
    const { t } = useTranslation('setting');
    const hints = {
      forward: useMailHotkeyHint(HotkeyEnum.MailForward),
      read: useMailHotkeyHint(unread ? HotkeyEnum.MailMarkRead : HotkeyEnum.MailMarkUnread),
      reply: useMailHotkeyHint(HotkeyEnum.MailReply),
      replyAll: useMailHotkeyHint(HotkeyEnum.MailReplyAll),
      star: useMailHotkeyHint(HotkeyEnum.MailStar),
      trash: useMailHotkeyHint(HotkeyEnum.MailTrash),
    };
    /** A disabled control says why instead, so it names no key. */
    const tip = (hotkey?: string, disabledReason?: string) =>
      disabledReason ? undefined : { hotkey };

    return (
      <Flexbox
        horizontal
        align={'center'}
        className={identityStyles.mailToolbar}
        data-testid={'mail-toolbar'}
        justify={'space-between'}
        // A narrow pane moves the paging pair to a second line instead of clipping it.
        wrap={'wrap'}
      >
        <Flexbox horizontal gap={4}>
          {onReply && (
            <ActionIcon
              aria-label={t('identity.compose.action.reply')}
              data-testid={'mail-action-reply'}
              disabled={Boolean(replyDisabledReason)}
              icon={Reply}
              title={replyDisabledReason ?? t('identity.compose.action.reply')}
              tooltipProps={tip(hints.reply, replyDisabledReason)}
              onClick={onReply}
            />
          )}
          {onReplyAll && (
            <ActionIcon
              aria-label={t('identity.compose.action.replyAll')}
              data-testid={'mail-action-reply-all'}
              disabled={Boolean(replyDisabledReason)}
              icon={ReplyAll}
              title={replyDisabledReason ?? t('identity.compose.action.replyAll')}
              tooltipProps={tip(hints.replyAll, replyDisabledReason)}
              onClick={onReplyAll}
            />
          )}
          {onForward && (
            <ActionIcon
              aria-label={t('identity.compose.action.forward')}
              data-testid={'mail-action-forward'}
              disabled={Boolean(forwardDisabledReason)}
              icon={Forward}
              title={forwardDisabledReason ?? t('identity.compose.action.forward')}
              tooltipProps={tip(hints.forward, forwardDisabledReason)}
              onClick={onForward}
            />
          )}
          {onRestore && (
            <ActionIcon
              aria-label={t('identity.mailbox.action.restore')}
              data-testid={'mail-action-restore'}
              icon={ArchiveRestore}
              title={t('identity.mailbox.action.restore')}
              onClick={onRestore}
            />
          )}
          {onTrash && (
            <ActionIcon
              aria-label={t('identity.mailbox.action.delete')}
              data-testid={'mail-action-trash'}
              icon={Trash2}
              title={t('identity.mailbox.action.delete')}
              tooltipProps={tip(hints.trash)}
              onClick={onTrash}
            />
          )}
          {onToggleStar && (
            <ActionIcon
              active={starred}
              aria-pressed={starred}
              data-testid={'mail-action-star'}
              icon={Star}
              title={t(starred ? 'identity.mailbox.action.unstar' : 'identity.mailbox.action.star')}
              tooltipProps={tip(hints.star)}
              aria-label={t(
                starred ? 'identity.mailbox.action.unstar' : 'identity.mailbox.action.star',
              )}
              onClick={onToggleStar}
            />
          )}
          {onToggleRead && (
            <ActionIcon
              data-testid={'mail-action-unread'}
              data-unread={unread}
              icon={unread ? MailOpen : Mail}
              tooltipProps={tip(hints.read)}
              aria-label={t(
                unread ? 'identity.mailbox.action.markRead' : 'identity.mailbox.action.markUnread',
              )}
              title={t(
                unread ? 'identity.mailbox.action.markRead' : 'identity.mailbox.action.markUnread',
              )}
              onClick={onToggleRead}
            />
          )}
        </Flexbox>
        <Flexbox horizontal gap={4}>
          <ActionIcon
            aria-label={t('identity.inbox.action.previous')}
            data-testid={'mail-nav-previous'}
            disabled={!hasPrevious}
            icon={ChevronUp}
            title={t('identity.inbox.action.previous')}
            onClick={onPrevious}
          />
          <ActionIcon
            aria-label={t('identity.inbox.action.next')}
            data-testid={'mail-nav-next'}
            disabled={!hasNext}
            icon={ChevronDown}
            title={t('identity.inbox.action.next')}
            onClick={onNext}
          />
        </Flexbox>
      </Flexbox>
    );
  },
);

MailDetailToolbar.displayName = 'AgentMailDetailToolbar';

export default MailDetailToolbar;

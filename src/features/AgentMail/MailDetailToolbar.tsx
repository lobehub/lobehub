'use client';

import { ActionIcon, Flexbox } from '@lobehub/ui';
import { ArchiveRestore, ChevronDown, ChevronUp, Mail, MailOpen, Star, Trash2 } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { identityStyles } from './styles';

export interface MailDetailToolbarProps {
  hasNext: boolean;
  hasPrevious: boolean;
  onNext: () => void;
  onPrevious: () => void;
  /** Only in the trash, where it takes the place of trashing. */
  onRestore?: () => void;
  onToggleRead?: () => void;
  onToggleStar?: () => void;
  onTrash?: () => void;
  starred: boolean;
  unread: boolean;
}

/** What can be done to the open conversation, and the way to the ones around it. */
const MailDetailToolbar = memo<MailDetailToolbarProps>(
  ({
    hasNext,
    hasPrevious,
    onNext,
    onPrevious,
    onRestore,
    onToggleRead,
    onToggleStar,
    onTrash,
    starred,
    unread,
  }) => {
    const { t } = useTranslation('setting');

    return (
      <Flexbox
        horizontal
        align={'center'}
        className={identityStyles.mailToolbar}
        data-testid={'mail-toolbar'}
        justify={'space-between'}
      >
        <Flexbox horizontal gap={4}>
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

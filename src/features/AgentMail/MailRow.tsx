'use client';

import { ActionIcon, Checkbox, Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { ArchiveRestore, Mail, MailOpen, Paperclip, Star, StarOff, Trash2, X } from 'lucide-react';
import type { MouseEvent, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { mailListStyles as styles } from './mailListStyles';
import { mailRowMarker } from './markers.stylex';
import type { MailActions } from './useMailActions';
import type { MailListItem, MailView } from './useMailList';

dayjs.extend(relativeTime);

interface MailRowProps {
  actions: MailActions;
  active: boolean;
  /** Touch has no hover, so the row's controls stay visible there. */
  alwaysShowControls: boolean;
  item: MailListItem;
  onOpen: () => void;
  onToggleSelect: (shiftKey: boolean) => void;
  readOnly?: boolean;
  /** Search results span views, so each says where it lives. */
  searching: boolean;
  selected: boolean;
  /** Something is selected: every row shows its checkbox. */
  selecting: boolean;
  view: MailView;
}

const stop = (event: MouseEvent) => event.stopPropagation();

const MailRow = ({
  actions,
  active,
  alwaysShowControls,
  item,
  onOpen,
  onToggleSelect,
  readOnly,
  searching,
  selected,
  selecting,
  view,
}: MailRowProps) => {
  const { t } = useTranslation('setting');
  const subject = item.subject || t('identity.inbox.noSubject');
  const party = item.party ?? t('identity.mailbox.noRecipient');
  const showCheckbox = !readOnly;

  const action = (
    key: string,
    icon: typeof Star,
    title: string,
    onClick: () => void,
  ): ReactNode => (
    <ActionIcon
      aria-label={title}
      icon={icon}
      key={key}
      size={'small'}
      title={title}
      onClick={(event: MouseEvent) => {
        event.stopPropagation();
        onClick();
      }}
    />
  );

  const buttons =
    view === 'drafts' && !searching
      ? [action('discard', X, t('identity.mailbox.action.discard'), () => actions.discard([item]))]
      : view === 'trash' && !searching
        ? [
            action('restore', ArchiveRestore, t('identity.mailbox.action.restore'), () =>
              actions.restore([item]),
            ),
            action('purge', Trash2, t('identity.mailbox.action.purge'), () =>
              actions.purge([item]),
            ),
          ]
        : [
            action(
              'star',
              item.isStarred ? StarOff : Star,
              item.isStarred
                ? t('identity.mailbox.action.unstar')
                : t('identity.mailbox.action.star'),
              () => actions.setStarred([item], !item.isStarred),
            ),
            action(
              'read',
              item.isUnread ? MailOpen : Mail,
              item.isUnread
                ? t('identity.mailbox.action.markRead')
                : t('identity.mailbox.action.markUnread'),
              () => actions.setRead([item], item.isUnread),
            ),
            action('delete', Trash2, t('identity.mailbox.action.delete'), () =>
              actions.trash([item]),
            ),
          ];

  return (
    <div
      {...stylex.props(styles.row, active && styles.rowActive, mailRowMarker)}
      aria-current={active ? 'true' : undefined}
      aria-label={`${party} — ${subject}`}
      role={'button'}
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onOpen();
      }}
    >
      {item.isUnread && !selecting && !selected && <span {...stylex.props(styles.dot)} />}
      {showCheckbox && (
        <span
          {...stylex.props(
            styles.checkbox,
            (selecting || selected || alwaysShowControls) && styles.checkboxAlways,
          )}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onToggleSelect(event.shiftKey);
          }}
        >
          <Checkbox checked={selected} size={14} />
        </span>
      )}
      <Flexbox gap={2} style={{ minWidth: 0 }}>
        <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
          <Flexbox horizontal align={'center'} gap={6} style={{ minWidth: 0 }}>
            <Text ellipsis fontSize={13} style={{ minWidth: 0 }} weight={item.isUnread ? 600 : 400}>
              {party}
            </Text>
            {item.mailCount > 1 && (
              <Text fontSize={12} style={{ flexShrink: 0 }} type={'secondary'}>
                {t('identity.mailbox.mailCount', { count: item.mailCount })}
              </Text>
            )}
          </Flexbox>
          <Flexbox horizontal align={'center'} gap={6} style={{ flexShrink: 0 }}>
            {item.hasAttachments && <Icon icon={Paperclip} size={12} />}
            {item.isStarred && (
              <Icon {...stylex.props(styles.starred)} fill={'currentColor'} icon={Star} size={13} />
            )}
            <Text fontSize={12} type={'secondary'}>
              {dayjs(item.at).fromNow()}
            </Text>
          </Flexbox>
        </Flexbox>
        <Flexbox horizontal align={'center'} gap={6}>
          <Text
            ellipsis
            fontSize={13}
            style={{ minWidth: 0 }}
            type={item.isUnread ? undefined : 'secondary'}
            weight={item.isUnread ? 500 : 400}
          >
            {subject}
          </Text>
          {searching && (
            <Tag size={'small'} style={{ flexShrink: 0 }}>
              {t(
                item.direction === 'outbound'
                  ? 'identity.mailbox.folder.sent'
                  : 'identity.mailbox.folder.inbox',
              )}
            </Tag>
          )}
        </Flexbox>
        {item.preview && (
          <Text ellipsis fontSize={12} type={'secondary'}>
            {item.preview}
          </Text>
        )}
      </Flexbox>
      {!readOnly && (
        <div
          {...stylex.props(styles.actions, alwaysShowControls && styles.actionsAlways)}
          onClick={stop}
        >
          {buttons}
        </div>
      )}
    </div>
  );
};

export default MailRow;

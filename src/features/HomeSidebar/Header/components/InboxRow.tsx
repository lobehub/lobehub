'use client';

import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { InboxIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import NavItem from '@/features/NavPanel/components/NavItem';

import { openInboxModal } from './InboxModal';
import { useInboxUnreadCount } from './useInboxUnreadCount';

const styles = stylex.create({
  count: {
    minWidth: '16px',
    height: '16px',
    paddingInline: '4px',
    borderRadius: '8px',
    fontSize: '11px',
    fontVariantNumeric: 'tabular-nums',
    lineHeight: '16px',
    color: cssVar.colorTextSecondary,
    textAlign: 'center',
    backgroundColor: cssVar.colorFillSecondary,
    backgroundImage: 'none',
  },
});

const InboxRow = () => {
  const { t } = useTranslation('notification');
  const { enabled, unreadCount } = useInboxUnreadCount();

  if (!enabled) return null;

  return (
    <NavItem
      icon={InboxIcon}
      title={t('inbox.title')}
      extra={
        unreadCount > 0 ? <span {...stylex.props(styles.count)}>{unreadCount}</span> : undefined
      }
      onClick={() => openInboxModal()}
    />
  );
};

export default InboxRow;

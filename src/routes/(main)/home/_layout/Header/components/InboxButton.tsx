'use client';

import { ActionIcon } from '@lobehub/ui';
import { Badge } from 'antd';
import { BellIcon } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';

import InboxDrawer from './InboxDrawer';
import { useInboxUnreadCount } from './useInboxUnreadCount';

const InboxButton = memo(() => {
  const { t } = useTranslation('notification');
  const [open, setOpen] = useState(false);
  const { enabled, unreadCount } = useInboxUnreadCount();

  const handleToggle = useCallback(() => {
    setOpen((prev) => !prev);
  }, []);

  const handleClose = useCallback(() => {
    setOpen(false);
  }, []);

  if (!enabled) return null;

  return (
    <>
      <Badge dot={unreadCount > 0} offset={[-6, 6]} size="small">
        <ActionIcon
          icon={BellIcon}
          size={DESKTOP_HEADER_ICON_SMALL_SIZE}
          title={t('inbox.title')}
          onClick={handleToggle}
        />
      </Badge>
      <InboxDrawer open={open} onClose={handleClose} />
    </>
  );
});

export default InboxButton;

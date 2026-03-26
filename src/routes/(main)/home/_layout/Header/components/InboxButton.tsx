'use client';

import { ActionIcon } from '@lobehub/ui';
import { Badge } from 'antd';
import { BellIcon } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DESKTOP_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import { useClientDataSWR } from '@/libs/swr';
import { notificationService } from '@/services/notification';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

import InboxDrawer from './InboxDrawer';
import { UNREAD_COUNT_KEY } from './InboxDrawer/constants';

const InboxButton = memo(() => {
  const { t } = useTranslation('notification');
  const [open, setOpen] = useState(false);
  const enableBusinessFeatures = useServerConfigStore(serverConfigSelectors.enableBusinessFeatures);

  const { data: unreadCount = 0 } = useClientDataSWR<number>(
    enableBusinessFeatures ? UNREAD_COUNT_KEY : null,
    () => notificationService.getUnreadCount(),
    { refreshInterval: 10_000 },
  );

  const handleToggle = useCallback(() => {
    setOpen((prev) => !prev);
  }, []);

  const handleClose = useCallback(() => {
    setOpen(false);
  }, []);

  if (!enableBusinessFeatures) return null;

  return (
    <>
      <Badge count={unreadCount} offset={[-4, 4]} size="small">
        <ActionIcon
          icon={BellIcon}
          size={DESKTOP_HEADER_ICON_SIZE}
          title={t('inbox.title')}
          onClick={handleToggle}
        />
      </Badge>
      <InboxDrawer open={open} onClose={handleClose} />
    </>
  );
});

export default InboxButton;

'use client';

import { ActionIcon } from '@lobehub/ui';
import { Badge } from 'antd';
import { BellIcon } from 'lucide-react';
import { memo, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';
import { type SideBarDrawerHandle } from '@/features/NavPanel/SideBarDrawer';
import { useClientDataSWR } from '@/libs/swr';
import { notificationService } from '@/services/notification';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

import InboxDrawer from './InboxDrawer';
import { UNREAD_COUNT_KEY } from './InboxDrawer/constants';

const InboxButton = memo(() => {
  const { t } = useTranslation('notification');
  const enableBusinessFeatures = useServerConfigStore(serverConfigSelectors.enableBusinessFeatures);

  const { data: unreadCount = 0 } = useClientDataSWR<number>(
    enableBusinessFeatures ? UNREAD_COUNT_KEY : null,
    () => notificationService.getUnreadCount(),
    { refreshInterval: 10_000 },
  );

  const drawerRef = useRef<SideBarDrawerHandle>(null);
  const handleOpen = useCallback(() => drawerRef.current?.open(), []);

  if (!enableBusinessFeatures) return null;

  return (
    <>
      <Badge dot={unreadCount > 0} offset={[-6, 6]} size="small">
        <ActionIcon
          icon={BellIcon}
          size={DESKTOP_HEADER_ICON_SMALL_SIZE}
          title={t('inbox.title')}
          onClick={handleOpen}
        />
      </Badge>
      <InboxDrawer ref={drawerRef} />
    </>
  );
});

export default InboxButton;

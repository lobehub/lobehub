import { useClientDataSWR } from '@/libs/swr';
import { inboxKeys } from '@/libs/swr/keys';
import { notificationService } from '@/services/notification';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

export const INBOX_UNREAD_COUNT_REFRESH_INTERVAL = 10_000;

export const useInboxUnreadCount = () => {
  const enableBusinessFeatures = useServerConfigStore(serverConfigSelectors.enableBusinessFeatures);
  const isLogin = useUserStore(authSelectors.isLogin);
  const enabled = enableBusinessFeatures && isLogin === true;

  const { data: unreadCount = 0 } = useClientDataSWR<number>(
    enabled ? inboxKeys.unreadCount() : null,
    () => notificationService.getUnreadCount(),
    { refreshInterval: INBOX_UNREAD_COUNT_REFRESH_INTERVAL },
  );

  return { enabled, unreadCount };
};

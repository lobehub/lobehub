import { DOWNLOAD_URL, isDesktop } from '@lobechat/const';
import { Icon } from '@lobehub/ui';
import { Download, LogOut } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { type MenuProps } from '@/components/Menu';
import { usePlatform } from '@/hooks/usePlatform';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

export const useAccountMenu = () => {
  const { t } = useTranslation(['common', 'auth']);
  const isLoginWithAuth = useUserStore(authSelectors.isLoginWithAuth);
  const { isIOS, isAndroid } = usePlatform();

  const downloadUrl = useMemo(() => {
    if (isIOS) return DOWNLOAD_URL.ios;
    if (isAndroid) return DOWNLOAD_URL.android;
    return DOWNLOAD_URL.default;
  }, [isIOS, isAndroid]);

  // Settings is reached via the gear icon in the AccountHeader; the menu only
  // covers items that don't have a dedicated entry point.
  const mainItems: MenuProps['items'] = isDesktop
    ? []
    : [
        {
          type: 'divider',
        },
        {
          icon: <Icon icon={Download} />,
          key: 'get-desktop-app',
          label: (
            <a href={downloadUrl} rel="noopener noreferrer" target="_blank">
              {t('getDesktopApp')}
            </a>
          ),
        },
      ];

  const logoutItems: MenuProps['items'] = isLoginWithAuth
    ? [
        {
          type: 'divider',
        },
        {
          icon: <Icon icon={LogOut} />,
          key: 'logout',
          label: <span>{t('signout', { ns: 'auth' })}</span>,
        },
      ]
    : [];

  return { logoutItems, mainItems };
};

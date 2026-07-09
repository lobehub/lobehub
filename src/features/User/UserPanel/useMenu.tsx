import { LOBE_CHAT_CLOUD, UTM_SOURCE } from '@lobechat/business-const';
import { isDesktop } from '@lobechat/const';
import { Flexbox, Hotkey, Icon, Tag } from '@lobehub/ui';
import type { ItemType } from 'antd/es/menu/interface';
import { BrainCircuit, Cloudy, Download, HardDriveDownload, LogOut, Settings2 } from 'lucide-react';
import type { PropsWithChildren } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import useBusinessMenuItems from '@/business/client/features/User/useBusinessMenuItems';
import { useHasActiveWorkspace } from '@/business/client/hooks/useHasActiveWorkspace';
import { type MenuProps } from '@/components/Menu';
import { DEFAULT_DESKTOP_HOTKEY_CONFIG } from '@/const/desktop';
import { OFFICIAL_URL } from '@/const/url';
import DataImporter from '@/features/DataImporter';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useNavLayout } from '@/hooks/useNavLayout';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

import { useNewVersion } from './useNewVersion';

const NewVersionBadge = memo(
  ({
    children,
    showBadge,
    onClick,
  }: PropsWithChildren & { onClick?: () => void; showBadge?: boolean }) => {
    const { t } = useTranslation('common');
    if (!showBadge)
      return (
        <Flexbox flex={1} onClick={onClick}>
          {children}
        </Flexbox>
      );
    return (
      <Flexbox horizontal align={'center'} flex={1} gap={8} width={'100%'} onClick={onClick}>
        {children}
        <Tag color={'info'} size={'small'} style={{ borderRadius: 16, paddingInline: 8 }}>
          {t('upgradeVersion.hasNew')}
        </Tag>
      </Flexbox>
    );
  },
);

export const useMenu = () => {
  const hasNewVersion = useNewVersion();
  const { t } = useTranslation(['common', 'setting', 'auth']);
  const { showCloudPromotion, hideDocs } = useServerConfigStore(featureFlagsSelectors);
  const [isLogin, isLoginWithAuth] = useUserStore((s) => [
    authSelectors.isLogin(s),
    authSelectors.isLoginWithAuth(s),
  ]);
  const { userPanel } = useNavLayout();
  const businessMenuItems = useBusinessMenuItems(isLogin);
  const hasActiveWorkspace = useHasActiveWorkspace();

  const settings: MenuProps['items'] = [
    {
      extra: isDesktop ? (
        <div>
          <Hotkey keys={DEFAULT_DESKTOP_HOTKEY_CONFIG.openSettings} />
        </div>
      ) : undefined,
      icon: <Icon icon={Settings2} />,
      key: 'setting',
      label: (
        <WorkspaceLink to="/settings">
          <NewVersionBadge showBadge={hasNewVersion}>
            {t(hasActiveWorkspace ? 'userPanel.workspaceSetting' : 'userPanel.setting')}
          </NewVersionBadge>
        </WorkspaceLink>
      ),
    },
    ...(userPanel.showMemory
      ? [
          {
            icon: <Icon icon={BrainCircuit} />,
            key: 'memory',
            label: <Link to="/memory">{t('tab.memory')}</Link>,
          },
        ]
      : []),
  ];

  const helps: MenuProps['items'] = [
    showCloudPromotion && {
      icon: <Icon icon={Cloudy} />,
      key: 'cloud',
      label: (
        <a
          href={`${OFFICIAL_URL}?utm_source=${UTM_SOURCE}`}
          rel="noopener noreferrer"
          target="_blank"
        >
          {t('userPanel.cloud', { name: LOBE_CHAT_CLOUD })}
        </a>
      ),
    },
  ].filter(Boolean) as ItemType[];

  const getApp: MenuProps['items'] = [
    {
      icon: <Icon icon={Download} />,
      key: 'get-app',
      label: (
        <WorkspaceLink escape to="/downloads">
          {t('getApp')}
        </WorkspaceLink>
      ),
    },
  ];

  const mainItems = [
    {
      type: 'divider',
    },

    ...(isLogin ? settings : []),
    ...businessMenuItems,
    ...(userPanel.showDataImporter && isLogin
      ? [
          {
            icon: <Icon icon={HardDriveDownload} />,
            key: 'import',
            label: <DataImporter>{t('importData')}</DataImporter>,
          },
          {
            type: 'divider' as const,
          },
        ]
      : []),
    ...(!hideDocs ? helps : []),
    ...(!isDesktop ? getApp : []),
  ]
    .filter(Boolean)
    // Remove consecutive dividers to prevent double divider lines
    .filter((item, index, arr) => {
      if (index === 0) return true;
      const isDivider = (i: any) => i && typeof i === 'object' && i.type === 'divider';
      return !(isDivider(item) && isDivider(arr[index - 1]));
    }) as MenuProps['items'];

  const logoutItems: MenuProps['items'] = isLoginWithAuth
    ? [
        {
          icon: <Icon icon={LogOut} />,
          key: 'logout',
          label: <span>{t('signout', { ns: 'auth' })}</span>,
        },
        {
          type: 'divider',
        },
      ]
    : [];

  return { logoutItems, mainItems };
};

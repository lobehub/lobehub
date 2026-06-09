import { LOBE_CHAT_CLOUD, UTM_SOURCE } from '@lobechat/business-const';
import { isDesktop } from '@lobechat/const';
import { Hotkey, Icon } from '@lobehub/ui';
import { type ItemType } from 'antd/es/menu/interface';
import { BrainCircuit, Cloudy, HardDriveDownload, Settings2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import useBusinessMenuItems from '@/business/client/features/User/useBusinessMenuItems';
import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { type MenuProps } from '@/components/Menu';
import { DEFAULT_DESKTOP_HOTKEY_CONFIG } from '@/const/desktop';
import { OFFICIAL_URL } from '@/const/url';
import DataImporter from '@/features/DataImporter';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useNavLayout } from '@/hooks/useNavLayout';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

export const useMenu = () => {
  const { t } = useTranslation(['common', 'setting']);
  const { showCloudPromotion, hideDocs } = useServerConfigStore(featureFlagsSelectors);
  const isLogin = useUserStore(authSelectors.isLogin);
  const { userPanel } = useNavLayout();
  const businessMenuItems = useBusinessMenuItems(isLogin);
  const activeWorkspaceSlug = useActiveWorkspaceSlug();

  // In workspace context, route Settings to the workspace's settings root —
  // the route's index redirect (`/:slug/settings → /:slug/settings/general`)
  // handles tab landing, keeping this hook URL-agnostic. Personal context
  // falls back to user settings.
  const settingsHref = activeWorkspaceSlug ? `/${activeWorkspaceSlug}/settings` : '/settings';

  const settings: MenuProps['items'] = isLogin
    ? [
        {
          extra: isDesktop ? (
            <div>
              <Hotkey keys={DEFAULT_DESKTOP_HOTKEY_CONFIG.openSettings} />
            </div>
          ) : undefined,
          icon: <Icon icon={Settings2} />,
          key: 'setting',
          label: <Link to={settingsHref}>{t('userPanel.setting')}</Link>,
        },
      ]
    : [];

  const memoryItems: MenuProps['items'] = userPanel.showMemory
    ? [
        {
          icon: <Icon icon={BrainCircuit} />,
          key: 'memory',
          label: <WorkspaceLink to="/memory">{t('tab.memory')}</WorkspaceLink>,
        },
      ]
    : [];

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

  const mainItems = [
    {
      type: 'divider',
    },
    ...settings,
    ...memoryItems,
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
  ]
    .filter(Boolean)
    // Remove consecutive dividers to prevent double divider lines
    .filter((item, index, arr) => {
      if (index === 0) return true;
      const isDivider = (i: any) => i && typeof i === 'object' && i.type === 'divider';
      return !(isDivider(item) && isDivider(arr[index - 1]));
    }) as MenuProps['items'];

  return { mainItems };
};

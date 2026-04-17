import type { MenuProps } from '@lobehub/ui';
import { Icon } from '@lobehub/ui';
import { Megaphone } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useGlobalStore } from '@/store/global';
import { useServerConfigStore } from '@/store/serverConfig';

import { billboardDismissKey } from './index';

export const useBillboardMenuItems = (): MenuProps['items'] => {
  const billboard = useServerConfigStore((s) => s.billboard);
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);
  const { t } = useTranslation('notification');

  return useMemo(() => {
    if (!billboard) return [];
    return [
      {
        icon: <Icon icon={Megaphone} />,
        key: `billboard-${billboard.slug}`,
        label: t('billboard.menuLabel'),
        onClick: () => {
          const slug = billboardDismissKey(billboard.slug);
          const current = useGlobalStore.getState().status.readNotificationSlugs ?? [];
          if (current.includes(slug)) {
            updateSystemStatus({
              readNotificationSlugs: current.filter((s) => s !== slug),
            });
          }
        },
      },
    ];
  }, [billboard, t, updateSystemStatus]);
};

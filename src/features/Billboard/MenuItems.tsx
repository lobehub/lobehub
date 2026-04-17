import type { MenuProps } from '@lobehub/ui';
import { Icon } from '@lobehub/ui';
import { Megaphone } from 'lucide-react';
import { useMemo } from 'react';

import { useBillboard } from '@/hooks/useBillboards';
import { useGlobalStore } from '@/store/global';

import { billboardDismissKey } from './index';

export const useBillboardMenuItems = (): MenuProps['items'] => {
  const { data: billboard } = useBillboard();
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);

  return useMemo(() => {
    if (!billboard) return [];
    return [
      {
        icon: <Icon icon={Megaphone} />,
        key: `billboard-${billboard.slug}`,
        label: billboard.title,
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
  }, [billboard, updateSystemStatus]);
};

'use client';

import { type MenuProps } from '@lobehub/ui';
import { Icon } from '@lobehub/ui';
import { Hash, LucideCheck } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { usePageStore } from '@/store/page';

export const useDropdownMenu = (): MenuProps['items'] => {
  const { t } = useTranslation();
  const showOnlyPagesNotInLibrary = usePageStore((s) => s.showOnlyPagesNotInLibrary);
  const setShowOnlyPagesNotInLibrary = usePageStore((s) => s.setShowOnlyPagesNotInLibrary);

  const [pagePageSize, updateSystemStatus] = useGlobalStore((s) => [
    systemStatusSelectors.pagePageSize(s),
    s.updateSystemStatus,
  ]);

  return useMemo(() => {
    const pageSizeOptions = [20, 40, 60, 100];
    const pageSizeItems = pageSizeOptions.map((size) => ({
      icon: pagePageSize === size ? <Icon icon={LucideCheck} /> : <div />,
      key: `pageSize-${size}`,
      label: t('pageList.pageSizeItem', { count: size, ns: 'file' }),
      onClick: () => {
        updateSystemStatus({ pagePageSize: size });
      },
    }));

    return [
      {
        children: pageSizeItems,
        icon: <Icon icon={Hash} />,
        key: 'displayItems',
        label: t('common:navPanel.displayItems'),
      },
    ];
  }, [
    t,
    setShowOnlyPagesNotInLibrary,
    showOnlyPagesNotInLibrary,
    pagePageSize,
    updateSystemStatus,
  ]);
};

'use client';

import { Icon } from '@lobehub/ui';
import type { MenuProps } from '@lobehub/ui';
import { Hash, LucideCheck } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useFileStore } from '@/store/file';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

export const useDropdownMenu = (): MenuProps['items'] => {
  const { t } = useTranslation();
  const showOnlyPagesNotInLibrary = useFileStore((s) => s.showOnlyPagesNotInLibrary);
  const setShowOnlyPagesNotInLibrary = useFileStore((s) => s.setShowOnlyPagesNotInLibrary);

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
      // {
      //   icon: <Icon icon={Check} style={{ opacity: !showOnlyPagesNotInLibrary ? 1 : 0 }} />,
      //   key: 'all',
      //   label: t('pageList.filter.all'),
      //   onClick: () => setShowOnlyPagesNotInLibrary(false),
      // },
      // {
      //   icon: <Icon icon={Check} style={{ opacity: showOnlyPagesNotInLibrary ? 1 : 0 }} />,
      //   key: 'onlyInPages',
      //   label: t('pageList.filter.onlyInPages'),
      //   onClick: () => setShowOnlyPagesNotInLibrary(true),
      // },
      // {
      //   type: 'divider' as const,
      // },
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

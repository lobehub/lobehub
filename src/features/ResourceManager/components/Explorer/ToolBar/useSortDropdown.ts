import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useResourceManagerStore } from '@/features/ResourceManager/store';
import { SortType } from '@/types/files';

type SorterKey = 'custom' | 'name' | 'createdAt' | 'size';

interface SortMenuItem {
  checked: boolean;
  key: string;
  label: string;
  onClick: () => void;
}

type SortMenuGroup =
  | { key: string; type: 'divider' }
  | { children: SortMenuItem[]; key: string; label: string; type: 'group' };

interface SortOption {
  key: SorterKey;
  label: string;
}

export const useSortDropdown = () => {
  const { t } = useTranslation('components');
  const libraryId = useResourceManagerStore((s) => s.libraryId);
  const sorter = useResourceManagerStore((s) => s.sorter) as SorterKey;
  const sortType = useResourceManagerStore((s) => s.sortType);
  const setSorter = useResourceManagerStore((s) => s.setSorter);
  const setSortType = useResourceManagerStore((s) => s.setSortType);

  const sortOptions = useMemo<SortOption[]>(() => {
    const options: SortOption[] = [
      { key: 'name', label: t('FileManager.sort.name') },
      { key: 'createdAt', label: t('FileManager.sort.dateAdded') },
      { key: 'size', label: t('FileManager.sort.size') },
    ];

    // Custom order only exists where rows carry a server-side sortOrder.
    if (libraryId) {
      options.unshift({
        key: 'custom',
        label: t('FileManager.sort.custom'),
      });
    }

    return options;
  }, [libraryId, t]);

  const handleFieldClick = useCallback(
    (key: SorterKey) => {
      if (sorter === key) return;

      setSorter(key);
      // Names read naturally A-Z; times and sizes are most useful newest/largest first.
      setSortType(key === 'name' || key === 'custom' ? SortType.Asc : SortType.Desc);
    },
    [setSorter, setSortType, sorter],
  );

  const menuItems: SortMenuGroup[] = useMemo(() => {
    const fieldItems: SortMenuItem[] = sortOptions.map((option) => ({
      checked: option.key === sorter,
      key: option.key,
      label: option.label,
      onClick: () => handleFieldClick(option.key),
    }));

    const directionItems: SortMenuItem[] = [
      {
        checked: sortType === SortType.Asc,
        key: 'asc',
        label: t('FileManager.sort.asc'),
        onClick: () => setSortType(SortType.Asc),
      },
      {
        checked: sortType === SortType.Desc,
        key: 'desc',
        label: t('FileManager.sort.desc'),
        onClick: () => setSortType(SortType.Desc),
      },
    ];

    return [
      {
        children: fieldItems,
        key: 'sort-field',
        label: t('FileManager.sort.by'),
        type: 'group',
      },
      { key: 'sort-direction-divider', type: 'divider' },
      {
        children: directionItems,
        key: 'sort-direction',
        label: t('FileManager.sort.direction'),
        type: 'group',
      },
    ];
  }, [handleFieldClick, setSortType, sortOptions, sorter, sortType, t]);

  const activeOption = sortOptions.find((option) => option.key === sorter);
  const directionLabel =
    sortType === SortType.Asc ? t('FileManager.sort.asc') : t('FileManager.sort.desc');
  const currentSortLabel = `${activeOption?.label || t('FileManager.sort.dateAdded')} · ${directionLabel}`;

  return { currentSortLabel, menuItems };
};

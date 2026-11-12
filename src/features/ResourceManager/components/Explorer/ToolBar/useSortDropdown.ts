import {
  ArrowDown,
  ArrowDownAZ,
  ArrowUp,
  CalendarIcon,
  GripVertical,
  HardDriveIcon,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useResourceManagerStore } from '@/features/ResourceManager/store';
import { SortType } from '@/types/files';

type SorterKey = 'custom' | 'name' | 'createdAt' | 'size';

type SortMenuItem =
  | { key: string; type: 'divider' }
  | {
      checked: boolean;
      icon: LucideIcon;
      key: string;
      label: string;
      onClick: () => void;
      type?: never;
    };

interface SortOption {
  icon: LucideIcon;
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
      { icon: ArrowDownAZ, key: 'name', label: t('FileManager.sort.name') },
      { icon: CalendarIcon, key: 'createdAt', label: t('FileManager.sort.dateAdded') },
      { icon: HardDriveIcon, key: 'size', label: t('FileManager.sort.size') },
    ];

    // Custom order only exists where rows carry a server-side sortOrder.
    if (libraryId) {
      options.unshift({
        icon: GripVertical,
        key: 'custom',
        label: t('FileManager.sort.custom'),
      });
    }

    return options;
  }, [libraryId, t]);

  const handleFieldClick = useCallback(
    (key: SorterKey) => {
      if (key === 'custom') {
        setSorter('custom');
        setSortType(SortType.Asc);
        return;
      }

      if (sorter === key) {
        setSortType(sortType === SortType.Asc ? SortType.Desc : SortType.Asc);
        return;
      }

      setSorter(key);
      // Names read naturally A-Z; times and sizes are most useful newest/largest first.
      setSortType(key === 'name' ? SortType.Asc : SortType.Desc);
    },
    [setSorter, setSortType, sorter, sortType],
  );

  const menuItems: SortMenuItem[] = useMemo(() => {
    const fieldItems: SortMenuItem[] = sortOptions.map((option) => ({
      checked: option.key === sorter,
      icon: option.icon,
      key: option.key,
      label: option.label,
      onClick: () => handleFieldClick(option.key),
    }));

    const directionItems: SortMenuItem[] = [
      {
        checked: sortType === SortType.Asc,
        icon: ArrowUp,
        key: 'asc',
        label: t('FileManager.sort.asc'),
        onClick: () => setSortType(SortType.Asc),
      },
      {
        checked: sortType === SortType.Desc,
        icon: ArrowDown,
        key: 'desc',
        label: t('FileManager.sort.desc'),
        onClick: () => setSortType(SortType.Desc),
      },
    ];

    return [...fieldItems, { key: 'sort-direction-divider', type: 'divider' }, ...directionItems];
  }, [handleFieldClick, setSortType, sortOptions, sorter, sortType, t]);

  const activeOption = sortOptions.find((option) => option.key === sorter);
  const directionLabel =
    sortType === SortType.Asc ? t('FileManager.sort.asc') : t('FileManager.sort.desc');
  const currentSortLabel = `${activeOption?.label || t('FileManager.sort.dateAdded')} · ${directionLabel}`;

  return { currentSortIcon: activeOption?.icon || ArrowDownAZ, currentSortLabel, menuItems };
};

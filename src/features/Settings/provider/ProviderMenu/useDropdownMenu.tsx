import { type MenuProps } from '@lobehub/ui';
import { Icon } from '@lobehub/ui';
import { LucideCheck } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { NativeContextMenuItem } from '@/libs/contextMenu/types';

// Sort type enumeration
export enum SortType {
  Alphabetical = 'alphabetical',
  AlphabeticalDesc = 'alphabeticalDesc',
  Default = 'default',
}

interface DropdownMenuProps {
  onSortChange: (sortType: SortType) => void;
  sortType: SortType;
}

export const useProviderDropdownMenu = ({
  onSortChange,
  sortType,
}: DropdownMenuProps): MenuProps['items'] => {
  const { t } = useTranslation('modelProvider');

  return useMemo(() => {
    const items: NativeContextMenuItem[] = [
      {
        icon: sortType === SortType.Default ? <Icon icon={LucideCheck} /> : <div />,
        key: 'default',
        label: t('menu.list.disabledActions.sortDefault'),
        onClick: () => onSortChange(SortType.Default),
        sfSymbol: sortType === SortType.Default ? 'checkmark' : undefined,
      },
      {
        type: 'divider' as const,
      },
      {
        icon: sortType === SortType.Alphabetical ? <Icon icon={LucideCheck} /> : <div />,
        key: 'alphabetical',
        label: t('menu.list.disabledActions.sortAlphabetical'),
        onClick: () => onSortChange(SortType.Alphabetical),
        sfSymbol: sortType === SortType.Alphabetical ? 'checkmark' : undefined,
      },
      {
        icon: sortType === SortType.AlphabeticalDesc ? <Icon icon={LucideCheck} /> : <div />,
        key: 'alphabeticalDesc',
        label: t('menu.list.disabledActions.sortAlphabeticalDesc'),
        onClick: () => onSortChange(SortType.AlphabeticalDesc),
        sfSymbol: sortType === SortType.AlphabeticalDesc ? 'checkmark' : undefined,
      },
    ];
    return items as MenuProps['items'];
  }, [sortType, onSortChange, t]);
};

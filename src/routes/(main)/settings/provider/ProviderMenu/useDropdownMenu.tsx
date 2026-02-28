import { type MenuProps } from '@lobehub/ui';
import { Icon } from '@lobehub/ui';
import { LucideCheck } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

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

  return useMemo(
    () => [
      {
        icon: sortType === SortType.Default ? <Icon icon={LucideCheck} /> : <div />,
        key: 'default',
        label: t('menu.list.disabledActions.sortDefault'),
        onClick: () => onSortChange(SortType.Default),
      },
      {
        type: 'divider' as const,
      },
      {
        icon: sortType === SortType.Alphabetical ? <Icon icon={LucideCheck} /> : <div />,
        key: 'alphabetical',
        label: t('menu.list.disabledActions.sortAlphabetical'),
        onClick: () => onSortChange(SortType.Alphabetical),
      },
      {
        icon: sortType === SortType.AlphabeticalDesc ? <Icon icon={LucideCheck} /> : <div />,
        key: 'alphabeticalDesc',
        label: t('menu.list.disabledActions.sortAlphabeticalDesc'),
        onClick: () => onSortChange(SortType.AlphabeticalDesc),
      },
    ],
    [sortType, onSortChange, t],
  );
};

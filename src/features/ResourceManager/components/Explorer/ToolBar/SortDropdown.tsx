import { DropdownMenu, type DropdownMenuCheckboxItem } from '@lobehub/ui';
import { ArrowDownAZ } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useResourceManagerStore } from '@/app/[variants]/(main)/resource/features/store';

import ActionIconWithChevron from './ActionIconWithChevron';

const SortDropdown = memo(() => {
  const { t } = useTranslation('components');
  const sorter = useResourceManagerStore((s) => s.sorter);
  const setSorter = useResourceManagerStore((s) => s.setSorter);

  const sortOptions = useMemo(
    () => [
      { key: 'name', label: t('FileManager.sort.name') },
      { key: 'createdAt', label: t('FileManager.sort.dateAdded') },
      { key: 'size', label: t('FileManager.sort.size') },
    ],
    [t],
  );

  const selectedKey = sorter || 'createdAt';

  const menuItems = useMemo<DropdownMenuCheckboxItem[]>(
    () =>
      sortOptions.map(
        (option): DropdownMenuCheckboxItem => ({
          checked: option.key === selectedKey,
          closeOnClick: true,
          key: option.key,
          label: option.label,
          onCheckedChange: (checked: boolean) => {
            if (checked) {
              setSorter(option.key as 'name' | 'createdAt' | 'size');
            }
          },
          type: 'checkbox',
        }),
      ),
    [selectedKey, setSorter, sortOptions],
  );

  const currentSortLabel =
    sortOptions.find((option) => option.key === sorter)?.label || t('FileManager.sort.dateAdded');

  return (
    <DropdownMenu items={menuItems}>
      <ActionIconWithChevron icon={ArrowDownAZ} title={currentSortLabel} />
    </DropdownMenu>
  );
});

SortDropdown.displayName = 'SortDropdown';

export default SortDropdown;

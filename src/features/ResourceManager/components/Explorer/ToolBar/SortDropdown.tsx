import { DropdownMenu, Icon } from '@lobehub/ui';
import { type LucideIcon } from 'lucide-react';
import { ArrowDownAZ, CalendarIcon, Check, HardDriveIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useResourceManagerStore } from '@/app/[variants]/(main)/resource/features/store';
import { type MenuProps } from '@/components/Menu';

import ActionIconWithChevron from './ActionIconWithChevron';

const SortDropdown = memo(() => {
  const { t } = useTranslation('components');
  const sorter = useResourceManagerStore((s) => s.sorter);
  const setSorter = useResourceManagerStore((s) => s.setSorter);

  const sortOptions: { icon: LucideIcon; key: string; label: string }[] = useMemo(
    () => [
      { icon: ArrowDownAZ, key: 'name', label: t('FileManager.sort.name') },
      { icon: CalendarIcon, key: 'createdAt', label: t('FileManager.sort.dateAdded') },
      { icon: HardDriveIcon, key: 'size', label: t('FileManager.sort.size') },
    ],
    [t],
  );

  const selectedKey = sorter || 'createdAt';

  const menuItems: MenuProps['items'] = useMemo(
    () =>
      sortOptions.map((option) => ({
        extra: option.key === selectedKey ? <Icon icon={Check} /> : undefined,
        icon: <Icon icon={option.icon} />,
        key: option.key,
        label: option.label,
        onClick: () => setSorter(option.key as 'name' | 'createdAt' | 'size'),
      })),
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

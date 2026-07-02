'use client';

import { ActionIcon, Flexbox } from '@lobehub/ui';
import { RectangleHorizontalIcon, Rows2Icon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useFleetStore } from './store';
import { type FleetRows } from './types';

const OPTIONS: { icon: typeof Rows2Icon; titleKey: string; value: FleetRows }[] = [
  { icon: RectangleHorizontalIcon, titleKey: 'fleet.rows.one', value: 1 },
  { icon: Rows2Icon, titleKey: 'fleet.rows.two', value: 2 },
];

/**
 * Compact 1 / 2 / 3 toggle for how many horizontal bands the board stacks
 * columns into. Lives in the sidebar header; the choice is persisted by the
 * store.
 */
const RowsSwitcher = memo(() => {
  const { t } = useTranslation('electron');
  const rows = useFleetStore((s) => s.rows);
  const setRows = useFleetStore((s) => s.setRows);

  return (
    <Flexbox horizontal align={'center'} gap={2}>
      {OPTIONS.map(({ value, icon, titleKey }) => (
        <ActionIcon
          active={rows === value}
          icon={icon}
          key={value}
          size={'small'}
          title={t(titleKey as 'fleet.rows.one')}
          onClick={() => setRows(value)}
        />
      ))}
    </Flexbox>
  );
});

RowsSwitcher.displayName = 'FleetRowsSwitcher';

export default RowsSwitcher;

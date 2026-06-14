'use client';

import { type DropdownItem, DropdownMenu, Icon } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { PlusIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useFleetStore } from './store';
import { type FleetColumn } from './types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  trigger: css`
    cursor: pointer;

    display: flex;
    flex: none;
    align-items: flex-start;
    justify-content: center;

    width: 52px;
    height: 100%;
    padding-block-start: 12px;

    color: ${cssVar.colorTextTertiary};

    transition: color 0.15s;

    &:hover {
      color: ${cssVar.colorPrimary};
    }
  `,
}));

interface AddColumnButtonProps {
  columns: FleetColumn[];
}

/**
 * Trailing "+" affordance at the right edge of the board. Opens a menu of
 * running tasks not currently shown so a closed column can be re-added.
 */
const AddColumnButton = memo<AddColumnButtonProps>(({ columns }) => {
  const { t } = useTranslation('electron');
  const openColumns = useFleetStore((s) => s.columns);
  const addColumn = useFleetStore((s) => s.addColumn);

  const items = useMemo<DropdownItem[]>(() => {
    const openKeySet = new Set(openColumns.map((c) => c.key));
    const available = columns.filter((c) => !openKeySet.has(c.key));
    if (available.length === 0)
      return [{ disabled: true, key: '__empty__', label: t('fleet.allShown') }];
    return available.map((column) => ({
      key: column.key,
      label: column.fallbackTitle,
      onClick: () => addColumn(column),
    }));
  }, [columns, openColumns, addColumn, t]);

  return (
    <DropdownMenu items={items} placement={'bottomRight'}>
      <div className={styles.trigger} title={t('fleet.addColumn')}>
        <Icon icon={PlusIcon} size={20} />
      </div>
    </DropdownMenu>
  );
});

AddColumnButton.displayName = 'FleetAddColumnButton';

export default AddColumnButton;

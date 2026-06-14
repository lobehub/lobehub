'use client';

import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, horizontalListSortingStrategy, SortableContext } from '@dnd-kit/sortable';
import { type TaskItem } from '@lobechat/types';
import { Flexbox, Icon, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { LayersIcon } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import AddColumnButton from './AddColumnButton';
import AgentColumn from './AgentColumn';
import { useFleetStore } from './store';
import { type FleetColumn } from './types';

const styles = createStaticStyles(({ css }) => ({
  board: css`
    overflow-x: auto;
    display: flex;
    flex: 1;
    align-items: stretch;

    height: 100%;
  `,
}));

interface ColumnsBoardProps {
  /** Live running columns — used by the trailing "+" menu to re-add closed ones. */
  runningColumns: FleetColumn[];
  taskByColumnKey: Record<string, TaskItem>;
}

const ColumnsBoard = memo<ColumnsBoardProps>(({ runningColumns, taskByColumnKey }) => {
  const { t } = useTranslation('electron');
  const columns = useFleetStore((s) => s.columns);
  const reorderColumns = useFleetStore((s) => s.reorderColumns);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const keys = useFleetStore.getState().columns.map((c) => c.key);
      const from = keys.indexOf(active.id as string);
      const to = keys.indexOf(over.id as string);
      if (from < 0 || to < 0) return;
      reorderColumns(arrayMove(keys, from, to));
    },
    [reorderColumns],
  );

  if (columns.length === 0) {
    return (
      <Flexbox align={'center'} flex={1} gap={8} justify={'center'}>
        <Icon icon={LayersIcon} size={40} style={{ color: 'var(--lobe-color-text-quaternary)' }} />
        <Text style={{ fontSize: 15, fontWeight: 500 }}>{t('fleet.empty')}</Text>
        <Text style={{ color: 'var(--lobe-color-text-tertiary)', fontSize: 13 }}>
          {t('fleet.emptyDesc')}
        </Text>
      </Flexbox>
    );
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className={styles.board}>
        <SortableContext items={columns.map((c) => c.key)} strategy={horizontalListSortingStrategy}>
          {columns.map((column) => (
            <AgentColumn column={column} key={column.key} task={taskByColumnKey[column.key]} />
          ))}
        </SortableContext>
        <AddColumnButton columns={runningColumns} />
      </div>
    </DndContext>
  );
});

ColumnsBoard.displayName = 'FleetColumnsBoard';

export default ColumnsBoard;

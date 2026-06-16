'use client';

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  type Modifier,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  horizontalListSortingStrategy,
  rectSortingStrategy,
  SortableContext,
} from '@dnd-kit/sortable';
import { Flexbox, Icon, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { LayersIcon } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type ChatTopicStatus } from '@/types/topic';

import AddColumnButton from './AddColumnButton';
import AgentColumn, { ColumnDragPreview } from './AgentColumn';
import { useFleetStore } from './store';
import { type FleetColumn } from './types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  band: css`
    overflow: auto hidden;
    display: flex;
    flex: 1 1 0;
    align-items: stretch;

    /* each band scrolls horizontally on its own; min-height:0 lets it shrink */
    min-height: 0;

    &:not(:last-child) {
      border-block-end: 1px solid ${cssVar.colorBorderSecondary};
    }
  `,
  board: css`
    overflow-x: auto;
    display: flex;
    flex: 1;
    align-items: stretch;

    height: 100%;
  `,
  boardVertical: css`
    display: flex;
    flex: 1;
    flex-direction: column;
    height: 100%;
  `,
}));

// Single-row reorder is horizontal-only — lock the drag transform to the X axis.
// Multi-band mode must allow vertical movement so a column can cross bands.
const restrictToHorizontalAxis: Modifier = ({ transform }) => ({ ...transform, y: 0 });

/** Group columns into `rows` bands by their persisted per-column row assignment. */
const groupIntoBands = (
  columns: FleetColumn[],
  rows: number,
  rowByKey: Record<string, number>,
): FleetColumn[][] => {
  const bands: FleetColumn[][] = Array.from({ length: rows }, () => []);
  for (const column of columns) {
    const row = Math.min(rows - 1, Math.max(0, rowByKey[column.key] ?? 0));
    bands[row].push(column);
  }
  return bands;
};

interface ColumnsBoardProps {
  statusByColumnKey: Record<string, ChatTopicStatus | undefined>;
}

const ColumnsBoard = memo<ColumnsBoardProps>(({ statusByColumnKey }) => {
  const { t } = useTranslation('electron');
  const columns = useFleetStore((s) => s.columns);
  const rows = useFleetStore((s) => s.rows);
  const rowByKey = useFleetStore((s) => s.rowByKey);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const [activeKey, setActiveKey] = useState<string | null>(null);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveKey(event.active.id as string);
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveKey(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const activeId = active.id as string;
    const overId = over.id as string;
    const state = useFleetStore.getState();
    // Multi-row: assign the dragged column to the dropped-on column's band and
    // splice it at that slot. Only this column moves, so other bands never
    // reflow — a cross-row drag inserts in place instead of wrapping the board.
    if (state.rows > 1) {
      state.moveColumn(activeId, overId, state.rowByKey[overId] ?? 0);
      return;
    }
    const keys = state.columns.map((c) => c.key);
    const from = keys.indexOf(activeId);
    const to = keys.indexOf(overId);
    if (from < 0 || to < 0) return;
    state.reorderColumns(arrayMove(keys, from, to));
  }, []);

  const handleDragCancel = useCallback(() => setActiveKey(null), []);

  const activeColumn = activeKey ? columns.find((c) => c.key === activeKey) : null;

  const isMultiBand = rows > 1 && columns.length > 0;

  const bands = useMemo(
    () => (isMultiBand ? groupIntoBands(columns, rows, rowByKey) : null),
    [isMultiBand, columns, rows, rowByKey],
  );

  const renderColumn = (column: FleetColumn) => (
    <AgentColumn column={column} key={column.key} status={statusByColumnKey[column.key]} />
  );

  let content: React.ReactNode;
  if (bands) {
    content = (
      <div className={styles.boardVertical}>
        {bands.map((band, bandIndex) => (
          <div className={styles.band} key={`band-${bandIndex}`}>
            {band.map(renderColumn)}
            <AddColumnButton insertAfterKey={band.at(-1)?.key} row={bandIndex} />
          </div>
        ))}
      </div>
    );
  } else {
    content = (
      <div className={styles.board}>
        {columns.map(renderColumn)}
        {columns.length === 0 ? (
          <Flexbox align={'center'} flex={1} gap={8} justify={'center'}>
            <Icon
              icon={LayersIcon}
              size={40}
              style={{ color: 'var(--lobe-color-text-quaternary)' }}
            />
            <Text style={{ fontSize: 15, fontWeight: 500 }}>{t('fleet.empty')}</Text>
            <Text style={{ color: 'var(--lobe-color-text-tertiary)', fontSize: 13 }}>
              {t('fleet.emptyDesc')}
            </Text>
          </Flexbox>
        ) : null}
        <AddColumnButton />
      </div>
    );
  }

  return (
    <DndContext
      collisionDetection={isMultiBand ? closestCenter : undefined}
      modifiers={isMultiBand ? undefined : [restrictToHorizontalAxis]}
      sensors={sensors}
      onDragCancel={handleDragCancel}
      onDragEnd={handleDragEnd}
      onDragStart={handleDragStart}
    >
      <SortableContext
        items={columns.map((c) => c.key)}
        strategy={isMultiBand ? rectSortingStrategy : horizontalListSortingStrategy}
      >
        {content}
      </SortableContext>
      <DragOverlay>
        {activeColumn ? (
          <ColumnDragPreview column={activeColumn} status={statusByColumnKey[activeColumn.key]} />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
});

ColumnsBoard.displayName = 'FleetColumnsBoard';

export default ColumnsBoard;

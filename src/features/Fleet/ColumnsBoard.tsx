'use client';

import {
  DndContext,
  type DragEndEvent,
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
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { type ChatTopicStatus } from '@/types/topic';

import AddColumnButton from './AddColumnButton';
import AgentColumn from './AgentColumn';
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

/**
 * Split the ordered columns into `rows` near-equal contiguous bands. The first
 * `remainder` bands carry one extra column so no band sits empty (e.g. 4 cols
 * into 3 rows → 2/1/1, never 2/2/0).
 */
const splitIntoBands = (columns: FleetColumn[], rows: number): FleetColumn[][] => {
  const base = Math.floor(columns.length / rows);
  const remainder = columns.length % rows;
  const bands: FleetColumn[][] = [];
  let cursor = 0;
  for (let band = 0; band < rows; band += 1) {
    const size = base + (band < remainder ? 1 : 0);
    bands.push(columns.slice(cursor, cursor + size));
    cursor += size;
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

  // Bands are a presentation slice over the single flat `columns` order, so drag
  // reorder (and cross-band moves) stay a plain reorder of that flat list.
  const isMultiBand = rows > 1 && columns.length > 0;

  const renderColumn = (column: FleetColumn) => (
    <AgentColumn column={column} key={column.key} status={statusByColumnKey[column.key]} />
  );

  let content: React.ReactNode;
  if (isMultiBand) {
    const bands = splitIntoBands(columns, rows);
    content = (
      <div className={styles.boardVertical}>
        {bands.map((band, bandIndex) => (
          <div className={styles.band} key={`band-${bandIndex}`}>
            {band.map(renderColumn)}
            {bandIndex === bands.length - 1 ? <AddColumnButton /> : null}
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
      modifiers={isMultiBand ? undefined : [restrictToHorizontalAxis]}
      sensors={sensors}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={columns.map((c) => c.key)}
        strategy={isMultiBand ? rectSortingStrategy : horizontalListSortingStrategy}
      >
        {content}
      </SortableContext>
    </DndContext>
  );
});

ColumnsBoard.displayName = 'FleetColumnsBoard';

export default ColumnsBoard;

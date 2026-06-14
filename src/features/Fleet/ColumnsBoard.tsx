'use client';

import {
  DndContext,
  type DragEndEvent,
  type Modifier,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { arrayMove, horizontalListSortingStrategy, SortableContext } from '@dnd-kit/sortable';
import { Flexbox, Icon, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { LayersIcon } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { type ChatTopicStatus } from '@/types/topic';

import AddColumnButton from './AddColumnButton';
import AgentColumn from './AgentColumn';
import { useFleetStore } from './store';

const styles = createStaticStyles(({ css }) => ({
  board: css`
    overflow-x: auto;
    display: flex;
    flex: 1;
    align-items: stretch;

    height: 100%;
  `,
}));

// Reorder is horizontal-only — lock the drag transform to the X axis.
const restrictToHorizontalAxis: Modifier = ({ transform }) => ({ ...transform, y: 0 });

interface ColumnsBoardProps {
  statusByColumnKey: Record<string, ChatTopicStatus | undefined>;
}

const ColumnsBoard = memo<ColumnsBoardProps>(({ statusByColumnKey }) => {
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

  return (
    <DndContext modifiers={[restrictToHorizontalAxis]} sensors={sensors} onDragEnd={handleDragEnd}>
      <div className={styles.board}>
        <SortableContext items={columns.map((c) => c.key)} strategy={horizontalListSortingStrategy}>
          {columns.map((column) => (
            <AgentColumn column={column} key={column.key} status={statusByColumnKey[column.key]} />
          ))}
        </SortableContext>
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
    </DndContext>
  );
});

ColumnsBoard.displayName = 'FleetColumnsBoard';

export default ColumnsBoard;

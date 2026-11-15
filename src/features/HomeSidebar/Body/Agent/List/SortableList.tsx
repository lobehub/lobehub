'use client';

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { SidebarAgentItem } from '@lobechat/types';
import { Flexbox, toast } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { useGlobalStore } from '@/store/global';

import {
  RowKeyboardSensor,
  RowMouseSensor,
  RowTouchSensor,
  sortableRowDropAnimation,
  suppressNextClick,
} from '../../sortableRow';
import GroupItem from './AgentGroupItem';
import AgentItem from './AgentItem';
import { applyPendingOrder, resolveSortableDrop } from './dropOutsideWindow';

const styles = stylex.create({
  overlay: {
    backgroundColor: cssVar.colorBgElevated,
    borderRadius: cssVar.borderRadius,
    boxShadow: cssVar.boxShadowSecondary,
    cursor: 'grabbing',
    pointerEvents: 'none',
  },
});

const Row = memo<{ item: SidebarAgentItem }>(({ item }) =>
  item.type === 'group' ? <GroupItem item={item} /> : <AgentItem item={item} />,
);

Row.displayName = 'SortableAgentRow';

const SortableRow = memo<{ item: SidebarAgentItem }>(({ item }) => {
  const { attributes, isDragging, listeners, setNodeRef, transform, transition } = useSortable({
    id: item.id,
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        // The floating copy follows the pointer; the row itself marks where it will land.
        opacity: isDragging ? 0.4 : undefined,
        transform: CSS.Translate.toString(transform),
        transition,
        // Holding the press before the drag starts would otherwise select the title.
        userSelect: 'none',
      }}
      {...attributes}
      {...listeners}
      // The row is natively draggable (drop it outside to open a new window).
      // That native drag would take the pointer away from the sort, so it is
      // cancelled here and the sort handles a drop outside the window instead.
      onDragStart={(e) => e.preventDefault()}
    >
      <Row item={item} />
    </div>
  );
});

SortableRow.displayName = 'SortableAgentListRow';

interface SortableListProps {
  dataSource: SidebarAgentItem[];
  /** Saves the new order of the rows in `dataSource`. */
  onReorder: (ids: string[]) => Promise<void>;
}

/**
 * A sidebar Agent list whose rows can be reordered by drag and drop, sharing
 * the sensors and drop animation of the Favorites list. Dropping a row
 * outside the window still opens it in a new window, as on a static list.
 */
const SortableList = memo<SortableListProps>(({ dataSource, onReorder }) => {
  const { t } = useTranslation('common');
  const openAgentInNewWindow = useGlobalStore((s) => s.openAgentInNewWindow);

  const [activeId, setActiveId] = useState<string>();
  // The dropped order, shown until the save settles: a save can wait behind an
  // earlier one, and the row must not snap back meanwhile. On failure the list
  // falls back to the store's (rolled back) order.
  const [pendingIds, setPendingIds] = useState<string[]>();
  const rows = useMemo(() => applyPendingOrder(dataSource, pendingIds), [dataSource, pendingIds]);
  const ids = useMemo(() => rows.map((item) => item.id), [rows]);

  const sensors = useSensors(
    useSensor(RowMouseSensor, { activationConstraint: { distance: 5 } }),
    // A press-and-hold picks a row up on touch, so a vertical swipe still scrolls the sidebar.
    useSensor(RowTouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(RowKeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const activeItem = activeId ? rows.find((item) => item.id === activeId) : undefined;

  const handleDragStart = ({ active }: DragStartEvent) => setActiveId(String(active.id));

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveId(undefined);
    suppressNextClick();

    const outcome = resolveSortableDrop(event, ids);
    if (outcome.type === 'openWindow') {
      openAgentInNewWindow(outcome.id);
      return;
    }
    if (outcome.type !== 'reorder') return;

    const nextIds = outcome.ids;
    setPendingIds(nextIds);
    try {
      await onReorder(nextIds);
    } catch (error) {
      console.error('[sidebar] failed to save the pinned order', error);
      toast.error(t('operationFailed'));
    } finally {
      // A later drop owns the pending order now; leave it in place.
      setPendingIds((current) => (current === nextIds ? undefined : current));
    }
  };

  return (
    <DndContext
      collisionDetection={closestCenter}
      sensors={sensors}
      onDragCancel={() => setActiveId(undefined)}
      onDragEnd={handleDragEnd}
      onDragStart={handleDragStart}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <Flexbox gap={1}>
          {rows.map((item) => (
            <SortableRow item={item} key={item.id} />
          ))}
        </Flexbox>
      </SortableContext>
      {createPortal(
        <DragOverlay dropAnimation={sortableRowDropAnimation}>
          {activeItem ? (
            <div {...stylex.props(styles.overlay)}>
              <Row item={activeItem} />
            </div>
          ) : null}
        </DragOverlay>,
        document.body,
      )}
    </DndContext>
  );
});

SortableList.displayName = 'SortableAgentList';

export default SortableList;

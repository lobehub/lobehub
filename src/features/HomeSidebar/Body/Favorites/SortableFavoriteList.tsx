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
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { FavoriteItem as FavoriteItemType } from '@lobechat/types';
import { toast } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { FavoriteIcon } from '@/features/Favorites';
import { toFavoritePath } from '@/features/Favorites/path';
import NavItem from '@/features/NavPanel/components/NavItem';
import { useActiveLocation } from '@/hooks/useActiveLocation';
import { useHomeStore } from '@/store/home';
import { isOptimisticId } from '@/store/home/slices/favorite/action';

import {
  RowKeyboardSensor,
  RowMouseSensor,
  RowTouchSensor,
  sortableRowDropAnimation,
  suppressNextClick,
} from '../sortableRow';
import FavoriteItem from './FavoriteItem';

const styles = stylex.create({
  overlay: {
    backgroundColor: cssVar.colorBgElevated,
    borderRadius: cssVar.borderRadius,
    boxShadow: cssVar.boxShadowSecondary,
    cursor: 'grabbing',
  },
});

const SortableFavoriteItem = memo<{ active: boolean; item: FavoriteItemType }>(
  ({ active, item }) => {
    const { attributes, isDragging, listeners, setNodeRef, transform, transition } = useSortable({
      // A row still being added has no server id, so its position could not be saved.
      disabled: isOptimisticId(item.id),
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
        // Stop the browser's native link drag from hijacking the pointer.
        onDragStart={(e) => e.preventDefault()}
      >
        <FavoriteItem active={active} item={item} />
      </div>
    );
  },
);

SortableFavoriteItem.displayName = 'SortableFavoriteItem';

const SortableFavoriteList = memo<{ items: FavoriteItemType[] }>(({ items }) => {
  const { t } = useTranslation('common');
  const reorderFavorites = useHomeStore((s) => s.reorderFavorites);
  const { pathname } = useActiveLocation();
  const currentPath = toFavoritePath(pathname, useActiveWorkspaceSlug());

  const [activeId, setActiveId] = useState<string>();
  const ids = useMemo(() => items.map((item) => item.id), [items]);

  const sensors = useSensors(
    useSensor(RowMouseSensor, { activationConstraint: { distance: 5 } }),
    // A press-and-hold picks a row up on touch, so a vertical swipe still scrolls the sidebar.
    useSensor(RowTouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(RowKeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const activeItem = activeId ? items.find((item) => item.id === activeId) : undefined;

  const handleDragStart = ({ active }: DragStartEvent) => setActiveId(String(active.id));

  const handleDragEnd = async ({ active, over }: DragEndEvent) => {
    setActiveId(undefined);
    suppressNextClick();
    if (!over || active.id === over.id) return;

    try {
      await reorderFavorites(
        arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))),
      );
    } catch (error) {
      console.error('[favorite] failed to save the order', error);
      toast.error(t('favorite.reorderError'));
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
        {items.map((item) => (
          <SortableFavoriteItem active={item.path === currentPath} item={item} key={item.id} />
        ))}
      </SortableContext>
      {createPortal(
        <DragOverlay dropAnimation={sortableRowDropAnimation}>
          {activeItem ? (
            <div {...stylex.props(styles.overlay)}>
              <NavItem
                icon={<FavoriteIcon icon={activeItem.icon} type={activeItem.type} />}
                // The card itself is the surface: no hover tint on top of the white.
                style={{ backgroundColor: 'transparent' }}
                title={activeItem.title}
              />
            </div>
          ) : null}
        </DragOverlay>,
        document.body,
      )}
    </DndContext>
  );
});

SortableFavoriteList.displayName = 'SortableFavoriteList';

export default SortableFavoriteList;

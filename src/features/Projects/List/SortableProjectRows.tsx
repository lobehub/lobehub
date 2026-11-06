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
import { Flexbox, Text, toast } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, type ReactNode, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import {
  RowKeyboardSensor,
  RowMouseSensor,
  RowTouchSensor,
  sortableRowDropAnimation,
  suppressNextClick,
} from '@/features/HomeSidebar/Body/sortableRow';
import { projectIcon } from '@/features/Projects/ProjectAvatar';
import type { ProjectListItem } from '@/store/project';
import { useProjectStore } from '@/store/project';

const styles = stylex.create({
  overlay: {
    backgroundColor: cssVar.colorBgElevated,
    borderRadius: cssVar.borderRadiusLG,
    boxShadow: cssVar.boxShadowSecondary,
    cursor: 'grabbing',
    paddingBlock: 8,
    paddingInline: 12,
  },
});

interface SortableRowProps {
  children: ReactNode;
  id: string;
}

const SortableRow = memo<SortableRowProps>(({ children, id }) => {
  const { attributes, isDragging, listeners, setNodeRef, transform, transition } = useSortable({
    id,
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
      {children}
    </div>
  );
});

SortableRow.displayName = 'SortableRow';

interface SortableProjectRowsProps {
  /** Rows in their current custom order — the whole list, never a search subset. */
  projects: ProjectListItem[];
  renderRow: (project: ProjectListItem) => ReactNode;
}

/** Drag to reorder the shared custom project order. */
const SortableProjectRows = memo<SortableProjectRowsProps>(({ projects, renderRow }) => {
  const { t } = useTranslation('project');
  const moveProject = useProjectStore((s) => s.moveProject);
  const [activeId, setActiveId] = useState<string>();
  const ids = useMemo(() => projects.map((p) => p.id), [projects]);

  const sensors = useSensors(
    useSensor(RowMouseSensor, { activationConstraint: { distance: 5 } }),
    // A press-and-hold picks a row up on touch, so a vertical swipe still scrolls the page.
    useSensor(RowTouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(RowKeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const activeProject = activeId ? projects.find((p) => p.id === activeId) : undefined;

  const handleDragStart = ({ active }: DragStartEvent) => setActiveId(String(active.id));

  const handleDragEnd = async ({ active, over }: DragEndEvent) => {
    setActiveId(undefined);
    suppressNextClick();
    if (!over || active.id === over.id) return;

    try {
      await moveProject(
        String(active.id),
        arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))),
      );
    } catch (error) {
      console.error('Failed to save project order', error);
      toast.error(t('sidebar.reorderError'));
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
        {projects.map((project) => (
          <SortableRow id={project.id} key={project.id}>
            {renderRow(project)}
          </SortableRow>
        ))}
      </SortableContext>
      {createPortal(
        <DragOverlay dropAnimation={sortableRowDropAnimation}>
          {activeProject ? (
            <Flexbox horizontal align={'center'} gap={8} {...stylex.props(styles.overlay)}>
              {projectIcon(activeProject)}
              <Text ellipsis weight={500}>
                {activeProject.name}
              </Text>
            </Flexbox>
          ) : null}
        </DragOverlay>,
        document.body,
      )}
    </DndContext>
  );
});

SortableProjectRows.displayName = 'SortableProjectRows';

export default SortableProjectRows;

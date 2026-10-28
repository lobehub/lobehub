'use client';

import {
  closestCenter,
  defaultDropAnimationSideEffects,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
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
import { toast } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import NavItem from '@/features/NavPanel/components/NavItem';
import { useCanManageProject } from '@/features/Projects/useCanManageProject';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import type { ProjectListItem } from '@/store/project';
import { useProjectStore } from '@/store/project';

import ProjectItem, { projectIcon } from './ProjectItem';
import { sortProjects } from './sortProjects';

const styles = stylex.create({
  overlay: {
    backgroundColor: cssVar.colorBgElevated,
    borderRadius: cssVar.borderRadius,
    boxShadow: cssVar.boxShadowSecondary,
    cursor: 'grabbing',
  },
});

const dropAnimation = {
  sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: '0.4' } } }),
};

// The row is a link: a click fires on pointerup after a drag, so swallow the
// one click that follows a drop instead of navigating to the dragged project.
const suppressNextClick = () => {
  const swallow = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
  window.addEventListener('click', swallow, { capture: true, once: true });
  // A drop that lands off the row produces no click; don't eat a later one.
  setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
};

// Pressing on a row's own buttons (the ⋯ menu) must never pick the row up.
const startsOnRowAction = (event: Event) =>
  event.target instanceof Element && !!event.target.closest('.nav-item-actions');

class RowMouseSensor extends MouseSensor {
  static activators = [
    {
      eventName: 'onMouseDown' as const,
      handler: ({ nativeEvent }: { nativeEvent: MouseEvent }) =>
        nativeEvent.button === 0 && !startsOnRowAction(nativeEvent),
    },
  ];
}

// A keyboard drag starts only from the focused row itself. Enter / Space on
// anything inside it — the project link, the ⋯ button — keeps its own meaning
// (open the project, open the menu).
const isRowItself = (event: Event) =>
  event.target instanceof Element &&
  event.target.getAttribute('aria-roledescription') === 'sortable';

class RowKeyboardSensor extends KeyboardSensor {
  static activators = KeyboardSensor.activators.map((activator) => ({
    ...activator,
    handler: (...args: Parameters<typeof activator.handler>) =>
      isRowItself(args[0].nativeEvent) && activator.handler(...args),
  }));
}

class RowTouchSensor extends TouchSensor {
  static activators = [
    {
      eventName: 'onTouchStart' as const,
      handler: ({ nativeEvent }: { nativeEvent: TouchEvent }) => !startsOnRowAction(nativeEvent),
    },
  ];
}

const SortableProjectItem = memo<{ project: ProjectListItem }>(({ project }) => {
  const { attributes, isDragging, listeners, setNodeRef, transform, transition } = useSortable({
    id: project.id,
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
      <ProjectItem project={project} />
    </div>
  );
});

SortableProjectItem.displayName = 'SortableProjectItem';

const SortableProjectList = memo<{ projects: ProjectListItem[] }>(({ projects }) => {
  const { t } = useTranslation('project');
  const sortBy = useGlobalStore(systemStatusSelectors.projectListSortBy);
  const moveProject = useProjectStore((s) => s.moveProject);
  // The manual order is shared by the workspace, so only editors may change it.
  const canManage = useCanManageProject();

  const [activeId, setActiveId] = useState<string>();
  const sorted = useMemo(() => sortProjects(projects, sortBy), [projects, sortBy]);
  const ids = useMemo(() => sorted.map((p) => p.id), [sorted]);

  const sensors = useSensors(
    useSensor(RowMouseSensor, { activationConstraint: { distance: 5 } }),
    // A press-and-hold picks a row up on touch, so a vertical swipe still scrolls the sidebar.
    useSensor(RowTouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(RowKeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  if (sortBy !== 'manual' || !canManage)
    return sorted.map((project) => <ProjectItem key={project.id} project={project} />);

  const activeProject = activeId ? sorted.find((p) => p.id === activeId) : undefined;

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
        {sorted.map((project) => (
          <SortableProjectItem key={project.id} project={project} />
        ))}
      </SortableContext>
      {createPortal(
        <DragOverlay dropAnimation={dropAnimation}>
          {activeProject ? (
            <div {...stylex.props(styles.overlay)}>
              <NavItem
                icon={projectIcon(activeProject)}
                // The card itself is the surface: no hover tint on top of the white.
                style={{ backgroundColor: 'transparent' }}
                title={activeProject.name}
              />
            </div>
          ) : null}
        </DragOverlay>,
        document.body,
      )}
    </DndContext>
  );
});

SortableProjectList.displayName = 'SortableProjectList';

export default SortableProjectList;

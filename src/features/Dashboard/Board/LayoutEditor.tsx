'use client';

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { DashboardItemLayout } from '@lobechat/types';
import { ActionIcon, Button, Flexbox, Icon, Text, toast } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { GripVerticalIcon, MoveDiagonal2Icon, PencilIcon } from 'lucide-react';
import {
  type KeyboardEvent as ReactKeyboardEvent,
  memo,
  type PointerEvent as ReactPointerEvent,
  useMemo,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

import type { DashboardBoardItem } from '@/services/dashboard';
import { dashboardSelectors, useDashboardStore } from '@/store/dashboard';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';
import { sx } from '@/styles/sx';

import {
  DASHBOARD_MIN_H,
  DASHBOARD_STACKED_QUERY,
  flowLayouts,
  resizeByKey,
  resizeByPointer,
} from '../utils/layout';
import WidgetCard from '../WidgetCard';
import { openWidgetEditModal } from '../WidgetEditModal';
import { cellStyle, gridProps, gridStyles } from './style';
import editStyles from './style.module.css';

type Size = { h: number; w: number };

interface ResizeHandleProps {
  layout: DashboardItemLayout;
  onResize: (size: Size) => void;
}

/** Whether the board is stacked in one column right now (narrow screen). */
const isStacked = () =>
  typeof window !== 'undefined' && window.matchMedia(DASHBOARD_STACKED_QUERY).matches;

/**
 * The card's bottom-right corner: drag to resize in whole columns and rows,
 * or focus it and use the arrow keys. On a stacked (narrow) board it resizes
 * height only, since every card spans the full width there.
 */
const ResizeHandle = ({ layout, onResize }: ResizeHandleProps) => {
  const { t } = useTranslation('dashboard');
  const [active, setActive] = useState(false);

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    const gridWidth = handle.closest('[data-dashboard-grid]')?.getBoundingClientRect().width ?? 0;
    const start = { h: layout.h, w: layout.w };
    const origin = { x: event.clientX, y: event.clientY };
    const stacked = isStacked();

    const handleMove = (moveEvent: PointerEvent) =>
      onResize(
        resizeByPointer(
          start,
          { dx: moveEvent.clientX - origin.x, dy: moveEvent.clientY - origin.y },
          gridWidth,
          { stacked },
        ),
      );
    const handleEnd = () => {
      setActive(false);
      handle.removeEventListener('pointermove', handleMove);
      handle.removeEventListener('pointerup', handleEnd);
      handle.removeEventListener('pointercancel', handleEnd);
    };

    handle.setPointerCapture(event.pointerId);
    setActive(true);
    handle.addEventListener('pointermove', handleMove);
    handle.addEventListener('pointerup', handleEnd);
    handle.addEventListener('pointercancel', handleEnd);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const next = resizeByKey(layout, event.key, { stacked: isStacked() });
    if (!next) return;
    event.preventDefault();
    onResize(next);
  };

  return (
    <button
      data-resize-handle
      aria-label={t('layout.resize')}
      className={editStyles.resizeHandle}
      data-active={active}
      title={t('layout.resize')}
      type={'button'}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
    >
      <Icon icon={MoveDiagonal2Icon} size={14} />
    </button>
  );
};

interface EditableCellProps {
  /** The user created this widget and may edit its title and metric definition. */
  editable: boolean;
  entry: DashboardBoardItem;
  layout: DashboardItemLayout;
  onResize: (size: Size) => void;
}

const EditableCell = memo<EditableCellProps>(({ entry, layout, onResize, editable }) => {
  const { t } = useTranslation('dashboard');
  const { attributes, isDragging, listeners, setNodeRef, transform, transition } = useSortable({
    id: entry.item.id,
  });

  return (
    <div
      {...sx([gridStyles.cell, isDragging && gridStyles.cellDragging], editStyles.editCell, {
        ...cellStyle(layout),
        transform: CSS.Translate.toString(transform),
        transition,
      })}
      data-layout-cell={entry.item.id}
      ref={setNodeRef}
    >
      <WidgetCard
        className={stylex.props(gridStyles.editCard).className}
        widget={entry.widget}
        handle={
          <span
            {...stylex.props(gridStyles.handle)}
            {...attributes}
            {...listeners}
            aria-label={t('layout.drag')}
          >
            <Icon icon={GripVerticalIcon} size={14} />
          </span>
        }
        title={
          <Flexbox horizontal align={'center'} gap={2} style={{ flex: 1, minWidth: 0 }}>
            <Text ellipsis title={entry.widget.title} weight={500}>
              {entry.widget.title}
            </Text>
            {editable && (
              <ActionIcon
                data-widget-edit
                icon={PencilIcon}
                size={'small'}
                title={t('widgetEdit.action')}
                onClick={() => openWidgetEditModal(entry.widget)}
              />
            )}
          </Flexbox>
        }
      />
      <ResizeHandle layout={layout} onResize={onResize} />
    </div>
  );
});

EditableCell.displayName = 'DashboardEditableCell';

interface LayoutEditorProps {
  dashboardId: string;
  /** Current cells, used as the starting point of the draft. */
  initialLayouts: Record<string, DashboardItemLayout>;
  /** Items in reading order. */
  items: DashboardBoardItem[];
  onDone: () => void;
}

/**
 * Edit a board's layout as a draft: drag cards to reorder, drag a corner to
 * resize, then save every cell to `dashboard_items.layout` in one request or
 * discard. A widget's own title and metric definition are edited from its
 * pencil icon and save on their own, outside the draft.
 */
const LayoutEditor = memo<LayoutEditorProps>(({ dashboardId, items, initialLayouts, onDone }) => {
  const { t } = useTranslation('dashboard');
  const saveDashboardLayout = useDashboardStore((s) => s.saveDashboardLayout);
  const saving = useDashboardStore(dashboardSelectors.isLayoutSaving(dashboardId));
  // Only a widget's creator may edit it; everyone else sees its title as is.
  const userId = useUserStore(userProfileSelectors.userId);

  const [order, setOrder] = useState(() => items.map((entry) => entry.item.id));
  const [sizes, setSizes] = useState<Record<string, Size>>(() =>
    Object.fromEntries(
      Object.entries(initialLayouts).map(([id, layout]) => [id, { h: layout.h, w: layout.w }]),
    ),
  );

  const byId = useMemo(() => new Map(items.map((entry) => [entry.item.id, entry])), [items]);
  const draftLayouts = useMemo(
    () =>
      flowLayouts(
        order
          .filter((id) => byId.has(id))
          .map((id) => ({ id, ...(sizes[id] ?? { h: DASHBOARD_MIN_H, w: 3 }) })),
      ),
    [order, sizes, byId],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    setOrder((current) =>
      arrayMove(current, current.indexOf(String(active.id)), current.indexOf(String(over.id))),
    );
  };

  const handleSave = async () => {
    try {
      await saveDashboardLayout(dashboardId, draftLayouts, order);
      toast.success(t('layout.saved'));
      onDone();
    } catch (error) {
      console.error('[dashboard] failed to save layout', error);
      toast.error(t('layout.saveFailed'));
    }
  };

  return (
    <Flexbox gap={12}>
      <Flexbox horizontal align={'center'} gap={8} justify={'flex-end'}>
        <Button disabled={saving} onClick={onDone}>
          {t('layout.cancel')}
        </Button>
        <Button
          data-dashboard-layout-save
          loading={saving}
          type={'primary'}
          onClick={() => void handleSave()}
        >
          {t('layout.save')}
        </Button>
      </Flexbox>
      <DndContext collisionDetection={closestCenter} sensors={sensors} onDragEnd={handleDragEnd}>
        <SortableContext items={order} strategy={rectSortingStrategy}>
          <div {...gridProps()} data-dashboard-grid={'editing'}>
            {order.map((id) => {
              const entry = byId.get(id);
              const layout = draftLayouts[id];
              if (!entry || !layout) return null;
              return (
                <EditableCell
                  editable={!!userId && entry.widget.userId === userId}
                  entry={entry}
                  key={id}
                  layout={layout}
                  onResize={(size) =>
                    setSizes((current) =>
                      current[id]?.w === size.w && current[id]?.h === size.h
                        ? current
                        : { ...current, [id]: size },
                    )
                  }
                />
              );
            })}
          </div>
        </SortableContext>
      </DndContext>
    </Flexbox>
  );
});

LayoutEditor.displayName = 'DashboardLayoutEditor';

export default LayoutEditor;

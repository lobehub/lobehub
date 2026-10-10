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
import { ActionIcon, Button, cx,Flexbox, Icon, toast   } from '@lobehub/ui';
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  GripVerticalIcon,
} from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { DashboardBoardItem } from '@/services/dashboard';
import { dashboardSelectors, useDashboardStore } from '@/store/dashboard';

import {
  DASHBOARD_MAX_H,
  DASHBOARD_MIN_H,
  DASHBOARD_WIDTH_PRESETS,
  flowLayouts,
} from '../utils/layout';
import WidgetCard from '../WidgetCard';
import { cellStyle, gridStyles } from './style';

type Size = { h: number; w: number };

const stepWidth = (w: number, direction: 1 | -1) => {
  const presets = [...DASHBOARD_WIDTH_PRESETS];
  if (direction > 0) return presets.find((preset) => preset > w) ?? w;
  return presets.reverse().find((preset) => preset < w) ?? w;
};

interface EditableCellProps {
  entry: DashboardBoardItem;
  layout: DashboardItemLayout;
  onResize: (size: Size) => void;
}

const EditableCell = memo<EditableCellProps>(({ entry, layout, onResize }) => {
  const { t } = useTranslation('dashboard');
  const { attributes, isDragging, listeners, setNodeRef, transform, transition } = useSortable({
    id: entry.item.id,
  });

  const resizeActions = (
    <>
      <ActionIcon
        aria-label={t('layout.narrower')}
        disabled={layout.w <= DASHBOARD_WIDTH_PRESETS[0]}
        icon={ChevronLeftIcon}
        size={'small'}
        title={t('layout.narrower')}
        onClick={() => onResize({ h: layout.h, w: stepWidth(layout.w, -1) })}
      />
      <ActionIcon
        aria-label={t('layout.wider')}
        disabled={layout.w >= DASHBOARD_WIDTH_PRESETS.at(-1)!}
        icon={ChevronRightIcon}
        size={'small'}
        title={t('layout.wider')}
        onClick={() => onResize({ h: layout.h, w: stepWidth(layout.w, 1) })}
      />
      <ActionIcon
        aria-label={t('layout.shorter')}
        disabled={layout.h <= DASHBOARD_MIN_H}
        icon={ChevronUpIcon}
        size={'small'}
        title={t('layout.shorter')}
        onClick={() => onResize({ h: layout.h - 1, w: layout.w })}
      />
      <ActionIcon
        aria-label={t('layout.taller')}
        disabled={layout.h >= DASHBOARD_MAX_H}
        icon={ChevronDownIcon}
        size={'small'}
        title={t('layout.taller')}
        onClick={() => onResize({ h: layout.h + 1, w: layout.w })}
      />
    </>
  );

  return (
    <div
      className={cx(gridStyles.cell, isDragging && gridStyles.cellDragging)}
      data-layout-cell={entry.item.id}
      ref={setNodeRef}
      style={{
        ...cellStyle(layout),
        transform: CSS.Translate.toString(transform),
        transition,
      }}
    >
      <WidgetCard
        actions={resizeActions}
        className={gridStyles.editCard}
        widget={entry.widget}
        handle={
          <span
            className={gridStyles.handle}
            {...attributes}
            {...listeners}
            aria-label={t('layout.drag')}
          >
            <Icon icon={GripVerticalIcon} size={14} />
          </span>
        }
      />
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
 * Edit a board's layout as a draft: drag to reorder, step width / height, then
 * save every cell to `dashboard_items.layout` in one request or discard.
 */
const LayoutEditor = memo<LayoutEditorProps>(({ dashboardId, items, initialLayouts, onDone }) => {
  const { t } = useTranslation('dashboard');
  const saveDashboardLayout = useDashboardStore((s) => s.saveDashboardLayout);
  const saving = useDashboardStore(dashboardSelectors.isLayoutSaving(dashboardId));

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
        <Button loading={saving} type={'primary'} onClick={() => void handleSave()}>
          {t('layout.save')}
        </Button>
      </Flexbox>
      <DndContext collisionDetection={closestCenter} sensors={sensors} onDragEnd={handleDragEnd}>
        <SortableContext items={order} strategy={rectSortingStrategy}>
          <div className={gridStyles.grid} data-dashboard-grid={'editing'}>
            {order.map((id) => {
              const entry = byId.get(id);
              const layout = draftLayouts[id];
              if (!entry || !layout) return null;
              return (
                <EditableCell
                  entry={entry}
                  key={id}
                  layout={layout}
                  onResize={(size) => setSizes((current) => ({ ...current, [id]: size }))}
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

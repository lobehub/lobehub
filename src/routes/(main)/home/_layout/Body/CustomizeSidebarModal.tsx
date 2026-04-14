'use client';

import {
  closestCenter,
  type CollisionDetection,
  defaultDropAnimationSideEffects,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ActionIcon, Button, Flexbox, Icon, Text, Tooltip } from '@lobehub/ui';
import { Modal } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { Eye, EyeOff, GripVertical, PinIcon, RotateCcw } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { create } from 'zustand';

import { getRouteById } from '@/config/routes';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { SIDEBAR_ACCORDION_KEYS } from '@/store/global/selectors/systemStatus';

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

const ACCORDION_GROUP_ID = 'accordion-group';

interface SidebarItemConfig {
  alwaysVisible?: boolean;
  id: string;
  labelKey: string;
  routeId?: string;
}

const ALL_SIDEBAR_ITEMS: SidebarItemConfig[] = [
  { id: 'pages', labelKey: 'tab.pages', routeId: 'page' },
  { id: 'recents', labelKey: 'recents' },
  { alwaysVisible: true, id: 'agent', labelKey: 'navPanel.agent' },
  { id: 'community', labelKey: 'tab.community', routeId: 'community' },
  { id: 'resource', labelKey: 'tab.resource', routeId: 'resource' },
  { id: 'memory', labelKey: 'tab.memory', routeId: 'memory' },
];

const ITEM_MAP = new Map(ALL_SIDEBAR_ITEMS.map((item) => [item.id, item]));

const isAccordionKey = (id: string) => SIDEBAR_ACCORDION_KEYS.has(id);

// ---------------------------------------------------------------------------
// Modal store
// ---------------------------------------------------------------------------

const useCustomizeSidebarModalStore = create<{
  open: boolean;
  setOpen: (open: boolean) => void;
}>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

export const openCustomizeSidebarModal = () =>
  useCustomizeSidebarModalStore.getState().setOpen(true);

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = createStaticStyles(({ css }) => ({
  accordionGroup: css`
    margin-inline: -5px;
    padding: 4px;
    border: 1px dashed ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};
  `,
  item: css`
    height: 40px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadius};
    transition: background 0.2s ease-in-out;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  itemDragging: css`
    opacity: 0;
  `,
  overlay: css`
    height: 40px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadius};

    background: ${cssVar.colorBgElevated};
    box-shadow: ${cssVar.boxShadowSecondary};
  `,
}));

// ---------------------------------------------------------------------------
// SortableItem
// ---------------------------------------------------------------------------

const SortableItem = memo<{
  hiddenSections: string[];
  id: string;
  onToggle: (key: string) => void;
}>(({ id, hiddenSections, onToggle }) => {
  const { t } = useTranslation('common');
  const item = ITEM_MAP.get(id);
  const {
    attributes,
    isDragging,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id });

  if (!item) return null;

  const route = item.routeId ? getRouteById(item.routeId) : undefined;
  const isHidden = !item.alwaysVisible && hiddenSections.includes(id);

  return (
    <Flexbox
      horizontal
      align={'center'}
      className={isDragging ? cx(styles.item, styles.itemDragging) : styles.item}
      gap={4}
      justify={'space-between'}
      ref={setNodeRef}
      style={{
        opacity: isHidden && !isDragging ? 0.5 : undefined,
        transform: CSS.Translate.toString(transform),
        transition,
      }}
      {...attributes}
    >
      <Flexbox horizontal align={'center'} gap={8}>
        <Flexbox
          ref={setActivatorNodeRef}
          style={{ cursor: isDragging ? 'grabbing' : 'grab', flexShrink: 0, touchAction: 'none' }}
          {...listeners}
        >
          <Icon icon={GripVertical} size={14} style={{ color: cssVar.colorTextQuaternary }} />
        </Flexbox>
        {route?.icon && <Icon icon={route.icon} size={18} />}
        <Text>{t(item.labelKey as any)}</Text>
      </Flexbox>
      {item.alwaysVisible ? (
        <Tooltip title={t('navPanel.pinned' as any)}>
          <ActionIcon icon={PinIcon} size={'small'} style={{ cursor: 'default', opacity: 0.45 }} />
        </Tooltip>
      ) : (
        <Tooltip title={t(isHidden ? ('navPanel.hidden' as any) : ('navPanel.visible' as any))}>
          <ActionIcon icon={isHidden ? EyeOff : Eye} size={'small'} onClick={() => onToggle(id)} />
        </Tooltip>
      )}
    </Flexbox>
  );
});

// ---------------------------------------------------------------------------
// AccordionGroup — a non-draggable slot at the outer level that wraps a nested
// SortableContext for accordion items. Registers with useSortable so other outer
// items can reorder relative to its position, but has no drag activator of its own.
// ---------------------------------------------------------------------------

const AccordionGroup = memo<{ children: React.ReactNode }>(({ children }) => {
  const { setNodeRef, transform, transition } = useSortable({ id: ACCORDION_GROUP_ID });

  return (
    <div
      className={styles.accordionGroup}
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
      }}
    >
      <Flexbox gap={2}>{children}</Flexbox>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Drag overlay item (static, no sortable hooks)
// ---------------------------------------------------------------------------

const OverlayItem = memo<{ id: string }>(({ id }) => {
  const { t } = useTranslation('common');

  // Accordion group overlay: render a compact representation
  if (id === ACCORDION_GROUP_ID) {
    return (
      <Flexbox horizontal align={'center'} className={styles.overlay} gap={8}>
        <Icon icon={GripVertical} size={14} style={{ color: cssVar.colorTextQuaternary }} />
        <Text>{t('navPanel.agent' as any)}</Text>
        <Text type={'secondary'}>+ {t('recents' as any)}</Text>
      </Flexbox>
    );
  }

  const item = ITEM_MAP.get(id);
  if (!item) return null;
  const route = item.routeId ? getRouteById(item.routeId) : undefined;

  return (
    <Flexbox horizontal align={'center'} className={styles.overlay} gap={8}>
      <Icon icon={GripVertical} size={14} style={{ color: cssVar.colorTextQuaternary }} />
      {route?.icon && <Icon icon={route.icon} size={18} />}
      <Text>{t(item.labelKey as any)}</Text>
    </Flexbox>
  );
});

// ---------------------------------------------------------------------------
// Main content
// ---------------------------------------------------------------------------

/** Flatten outer list (with ACCORDION_GROUP_ID placeholder) + inner accordion items → full list. */
const flattenItems = (outer: string[], inner: string[]): string[] =>
  outer.flatMap((id) => (id === ACCORDION_GROUP_ID ? inner : [id]));

const CustomizeSidebarContent = memo(() => {
  const [storeItems, hiddenSections, updateSystemStatus] = useGlobalStore((s) => [
    systemStatusSelectors.sidebarItems(s),
    systemStatusSelectors.hiddenSidebarSections(s),
    s.updateSystemStatus,
  ]);

  // Local state for drag operations — only persisted on dragEnd
  const [items, setItems] = useState<string[]>(storeItems);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Sync local state when store changes (e.g. reset)
  useEffect(() => {
    setItems(storeItems);
  }, [storeItems]);

  // Derive outer (with group placeholder) and inner (accordion items)
  const { innerItems, outerItems } = useMemo(() => {
    const outer: string[] = [];
    const inner: string[] = [];
    let insertedGroup = false;
    for (const id of items) {
      if (isAccordionKey(id)) {
        inner.push(id);
        if (!insertedGroup) {
          outer.push(ACCORDION_GROUP_ID);
          insertedGroup = true;
        }
      } else {
        outer.push(id);
      }
    }
    return { innerItems: inner, outerItems: outer };
  }, [items]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const toggleSection = useCallback(
    (key: string) => {
      const isHidden = hiddenSections.includes(key);
      const newHidden = isHidden
        ? hiddenSections.filter((k) => k !== key)
        : [...hiddenSections, key];
      updateSystemStatus({ hiddenSidebarSections: newHidden });
    },
    [hiddenSections, updateSystemStatus],
  );

  // Collision detection: restrict targets to the same container as the active item.
  // - Active in inner (recents/agent) → only collide with inner items
  // - Active in outer (pages/community/... or the group itself) → only collide with outer items
  const collisionDetection = useCallback<CollisionDetection>((args) => {
    const activeId = args.active.id as string;
    const isInner = isAccordionKey(activeId);
    const droppableContainers = args.droppableContainers.filter((c) => {
      const id = c.id as string;
      const targetIsInner = isAccordionKey(id);
      return isInner === targetIsInner;
    });
    return closestCenter({ ...args, droppableContainers });
  }, []);

  // ---- DnD handlers ----

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveId(null);
      if (!over || active.id === over.id) return;

      const activeKey = active.id as string;
      const overKey = over.id as string;

      let next: string[];
      if (isAccordionKey(activeKey)) {
        // Inner reorder (recents ↔ agent)
        const oldIdx = innerItems.indexOf(activeKey);
        const newIdx = innerItems.indexOf(overKey);
        if (oldIdx === -1 || newIdx === -1) return;
        next = flattenItems(outerItems, arrayMove(innerItems, oldIdx, newIdx));
      } else {
        // Outer reorder (pages/community/... or the whole accordion group)
        const oldIdx = outerItems.indexOf(activeKey);
        const newIdx = outerItems.indexOf(overKey);
        if (oldIdx === -1 || newIdx === -1) return;
        next = flattenItems(arrayMove(outerItems, oldIdx, newIdx), innerItems);
      }

      setItems(next);
      updateSystemStatus({ sidebarItems: next });
    },
    [innerItems, outerItems, updateSystemStatus],
  );

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
    setItems(storeItems);
  }, [storeItems]);

  const renderItem = (id: string) => (
    <SortableItem hiddenSections={hiddenSections} id={id} key={id} onToggle={toggleSection} />
  );

  return (
    <DndContext
      collisionDetection={collisionDetection}
      sensors={sensors}
      onDragCancel={handleDragCancel}
      onDragEnd={handleDragEnd}
      onDragStart={handleDragStart}
    >
      <SortableContext items={outerItems} strategy={verticalListSortingStrategy}>
        <Flexbox gap={2}>
          {outerItems.map((id) =>
            id === ACCORDION_GROUP_ID ? (
              <AccordionGroup key={id}>
                <SortableContext items={innerItems} strategy={verticalListSortingStrategy}>
                  {innerItems.map(renderItem)}
                </SortableContext>
              </AccordionGroup>
            ) : (
              renderItem(id)
            ),
          )}
        </Flexbox>
      </SortableContext>

      {createPortal(
        <DragOverlay dropAnimation={{ sideEffects: defaultDropAnimationSideEffects({}) }}>
          {activeId ? <OverlayItem id={activeId} /> : null}
        </DragOverlay>,
        document.body,
      )}
    </DndContext>
  );
});

// ---------------------------------------------------------------------------
// Modal wrapper
// ---------------------------------------------------------------------------

export const CustomizeSidebarModal = memo(() => {
  const { t } = useTranslation('common');
  const open = useCustomizeSidebarModalStore((s) => s.open);
  const setOpen = useCustomizeSidebarModalStore((s) => s.setOpen);
  const resetSidebarCustomization = useGlobalStore((s) => s.resetSidebarCustomization);

  return (
    <Modal
      centered
      destroyOnHidden
      open={open}
      title={t('navPanel.customizeSidebar')}
      width={360}
      footer={
        <Button
          block
          icon={<Icon icon={RotateCcw} />}
          type={'text'}
          onClick={resetSidebarCustomization}
        >
          {t('navPanel.resetDefault' as any)}
        </Button>
      }
      onCancel={() => setOpen(false)}
    >
      <CustomizeSidebarContent />
    </Modal>
  );
});

'use client';

import {
  closestCorners,
  defaultDropAnimationSideEffects,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
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
import { Divider } from 'antd';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { Eye, EyeOff, GripVertical, PinIcon, RotateCcw } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { create } from 'zustand';

import { getRouteById } from '@/config/routes';
import { useGlobalStore } from '@/store/global';
import { type SidebarZones, systemStatusSelectors } from '@/store/global/selectors';

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

type ZoneKey = keyof SidebarZones;

/** Items that must stay in the middle (Sections) zone. */
const LOCKED_TO_MIDDLE = new Set(['recents', 'agent']);

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
];

const ITEM_MAP = new Map(ALL_SIDEBAR_ITEMS.map((item) => [item.id, item]));

const ZONE_LABELS: Record<ZoneKey, string> = {
  bottom: 'navPanel.zoneBottom',
  middle: 'navPanel.zoneMiddle',
  top: 'navPanel.zoneTop',
};

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
  emptyZone: css`
    display: flex;
    align-items: center;
    justify-content: center;

    min-height: 40px;
    border: 1px dashed ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};

    transition: all 0.2s ease-in-out;
  `,
  emptyZoneActive: css`
    border-color: ${cssVar.colorPrimaryBorder};
    background: ${cssVar.colorPrimaryBg};
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
  zone: css`
    min-height: 4px;
    border-radius: ${cssVar.borderRadius};
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
// Drag overlay item (static, no sortable hooks)
// ---------------------------------------------------------------------------

const OverlayItem = memo<{ id: string }>(({ id }) => {
  const { t } = useTranslation('common');
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
// Zone label
// ---------------------------------------------------------------------------

const ZoneLabel = memo<{ label: string }>(({ label }) => (
  <Flexbox paddingBlock={4} paddingInline={8}>
    <Text ellipsis size={12} type={'secondary'} weight={500}>
      {label}
    </Text>
  </Flexbox>
));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const findZone = (id: string, zones: SidebarZones): ZoneKey | null => {
  if (zones.top.includes(id)) return 'top';
  if (zones.middle.includes(id)) return 'middle';
  if (zones.bottom.includes(id)) return 'bottom';
  return null;
};

// ---------------------------------------------------------------------------
// Droppable zone container (makes empty zones valid drop targets)
// ---------------------------------------------------------------------------

const DroppableZone = memo<{
  children: React.ReactNode;
  isDragging: boolean;
  zoneKey: string;
}>(({ zoneKey, isDragging, children }) => {
  const { setNodeRef, isOver } = useDroppable({ id: zoneKey });
  const hasChildren = children !== null;

  return (
    <Flexbox className={styles.zone} gap={2} ref={setNodeRef}>
      {hasChildren ? (
        children
      ) : (
        <div className={isOver ? cx(styles.emptyZone, styles.emptyZoneActive) : styles.emptyZone} />
      )}
    </Flexbox>
  );
});

// ---------------------------------------------------------------------------
// Main content
// ---------------------------------------------------------------------------

const CustomizeSidebarContent = memo(() => {
  const { t } = useTranslation('common');

  const [storeZones, hiddenSections, updateSystemStatus] = useGlobalStore((s) => [
    systemStatusSelectors.sidebarZones(s),
    systemStatusSelectors.hiddenSidebarSections(s),
    s.updateSystemStatus,
  ]);

  // Local state for drag operations — only persisted on dragEnd
  const [zones, setZones] = useState<SidebarZones>(storeZones);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Sync local state when store changes (e.g. reset)
  useEffect(() => {
    setZones(storeZones);
  }, [storeZones]);

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

  // ---- DnD handlers ----

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  }, []);

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { active, over } = event;
      if (!over) return;

      const activeItemId = active.id as string;
      const overId = over.id as string;

      // Locked items cannot leave the middle zone
      if (LOCKED_TO_MIDDLE.has(activeItemId)) return;

      const fromZone = findZone(activeItemId, zones);
      // over could be an item or a zone container id
      const toZone = findZone(overId, zones) ?? (overId as ZoneKey);

      if (!fromZone || !toZone || fromZone === toZone) return;

      setZones((prev) => {
        const fromItems = [...prev[fromZone]];
        const toItems = [...prev[toZone as ZoneKey]];

        const fromIdx = fromItems.indexOf(activeItemId);
        if (fromIdx < 0) return prev;
        fromItems.splice(fromIdx, 1);

        // Insert at the position of the hovered item, or append
        const overIdx = toItems.indexOf(overId);
        toItems.splice(overIdx >= 0 ? overIdx : toItems.length, 0, activeItemId);

        return { ...prev, [fromZone]: fromItems, [toZone]: toItems };
      });
    },
    [zones],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveId(null);

      if (!over) return;

      const activeItemId = active.id as string;
      const overId = over.id as string;

      const zone = findZone(activeItemId, zones);
      if (!zone) return;

      // Within-container reorder
      const items = zones[zone];
      const oldIdx = items.indexOf(activeItemId);
      const newIdx = items.indexOf(overId);

      let finalZones = zones;
      if (oldIdx !== -1 && newIdx !== -1 && oldIdx !== newIdx) {
        finalZones = { ...zones, [zone]: arrayMove(items, oldIdx, newIdx) };
        setZones(finalZones);
      }

      // Persist to store
      updateSystemStatus({ sidebarZones: finalZones });
    },
    [zones, updateSystemStatus],
  );

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
    setZones(storeZones); // reset to stored state
  }, [storeZones]);

  // ---- Render zone ----

  const renderZone = (zoneKey: ZoneKey) => {
    const items = zones[zoneKey];

    return (
      <SortableContext id={zoneKey} items={items} strategy={verticalListSortingStrategy}>
        <DroppableZone isDragging={!!activeId} zoneKey={zoneKey}>
          {items.length === 0
            ? null
            : items.map((id) => (
                <SortableItem
                  hiddenSections={hiddenSections}
                  id={id}
                  key={id}
                  onToggle={toggleSection}
                />
              ))}
        </DroppableZone>
      </SortableContext>
    );
  };

  return (
    <DndContext
      collisionDetection={closestCorners}
      sensors={sensors}
      onDragCancel={handleDragCancel}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      onDragStart={handleDragStart}
    >
      <Flexbox gap={0}>
        <ZoneLabel label={t(ZONE_LABELS.top as any)} />
        {renderZone('top')}

        <Divider style={{ margin: '4px 0' }} />
        <ZoneLabel label={t(ZONE_LABELS.middle as any)} />
        {renderZone('middle')}

        <Divider style={{ margin: '4px 0' }} />
        <ZoneLabel label={t(ZONE_LABELS.bottom as any)} />
        {renderZone('bottom')}
      </Flexbox>

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

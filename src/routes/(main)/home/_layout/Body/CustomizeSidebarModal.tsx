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
import { ActionIcon, Flexbox, Icon, Text, Tooltip } from '@lobehub/ui';
import { Button, createModal, type ModalInstance, useModalContext } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { t } from 'i18next';
import { ArrowDownToLine, Eye, EyeOff, GripVertical, PinIcon, RotateCcw } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { getRouteById } from '@/config/routes';
import { useGlobalStore } from '@/store/global';
import { DEFAULT_HOME_SIDEBAR_EXPANDED_KEYS } from '@/store/global/initialState';
import { systemStatusSelectors } from '@/store/global/selectors';
import {
  DEFAULT_HIDDEN_SECTIONS,
  DEFAULT_SIDEBAR_ITEMS,
  SIDEBAR_ACCORDION_KEYS,
  SIDEBAR_SPACER_ID,
} from '@/store/global/selectors/systemStatus';

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

const ACCORDION_GROUP_ID = 'accordion-group';

export interface SidebarItemConfig {
  alwaysVisible?: boolean;
  id: string;
  labelKey: string;
  routeId?: string;
}

const ALL_SIDEBAR_ITEMS: SidebarItemConfig[] = [
  { id: 'tasks', labelKey: 'tab.tasks', routeId: 'tasks' },
  { id: 'pages', labelKey: 'tab.pages', routeId: 'page' },
  { id: 'recents', labelKey: 'recents' },
  { alwaysVisible: true, id: 'agent', labelKey: 'navPanel.agent' },
  { id: 'image', labelKey: 'tab.generation', routeId: 'image' },
  { id: 'community', labelKey: 'tab.community', routeId: 'community' },
  { id: 'resource', labelKey: 'tab.resource', routeId: 'resource' },
  { id: 'memory', labelKey: 'tab.memory', routeId: 'memory' },
];

export const getAvailableSidebarItems = (isWorkspaceMode: boolean): SidebarItemConfig[] =>
  ALL_SIDEBAR_ITEMS.filter((item) => !(isWorkspaceMode && item.id === 'memory'));

export const getSortableSidebarItemIds = (isWorkspaceMode: boolean): Set<string> =>
  new Set([...getAvailableSidebarItems(isWorkspaceMode).map((item) => item.id), SIDEBAR_SPACER_ID]);

const ITEM_MAP = new Map(ALL_SIDEBAR_ITEMS.map((item) => [item.id, item]));

const isAccordionKey = (id: string) => SIDEBAR_ACCORDION_KEYS.has(id);
const isSpacer = (id: string) => id === SIDEBAR_SPACER_ID;

const mergeAvailableSidebarItems = (
  currentItems: string[],
  nextAvailableItems: string[],
  availableItemIds: Set<string>,
): string[] => {
  let nextAvailableIndex = 0;
  const nextItems = currentItems.map((id) => {
    if (!availableItemIds.has(id)) return id;

    return nextAvailableItems[nextAvailableIndex++] ?? id;
  });

  return [...nextItems, ...nextAvailableItems.slice(nextAvailableIndex)];
};

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
  spacerLine: css`
    flex: 1;
    block-size: 1px;
    background: ${cssVar.colorBorderSecondary};
  `,
  footer: css`
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
    padding-block-start: 16px;
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
// SpacerSortableItem — represents the flex spacer slot when it is not bound to
// the accordion group; draggable like any other item.
// ---------------------------------------------------------------------------

const SpacerSortableItem = memo(() => {
  const { t } = useTranslation('common');
  const {
    attributes,
    isDragging,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: SIDEBAR_SPACER_ID });

  return (
    <Flexbox
      horizontal
      align={'center'}
      className={isDragging ? cx(styles.item, styles.itemDragging) : styles.item}
      gap={8}
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
      }}
      {...attributes}
    >
      <Flexbox
        ref={setActivatorNodeRef}
        style={{ cursor: isDragging ? 'grabbing' : 'grab', flexShrink: 0, touchAction: 'none' }}
        {...listeners}
      >
        <Icon icon={GripVertical} size={14} style={{ color: cssVar.colorTextQuaternary }} />
      </Flexbox>
      <Icon icon={ArrowDownToLine} size={14} style={{ color: cssVar.colorTextQuaternary }} />
      <div className={styles.spacerLine} />
      <Text style={{ fontSize: 12 }} type={'secondary'}>
        {t('navPanel.bottomDivider' as any)}
      </Text>
      <div className={styles.spacerLine} />
    </Flexbox>
  );
});

const BoundSpacerItem = memo(() => {
  const { t } = useTranslation('common');

  return (
    <Flexbox horizontal align={'center'} className={styles.item} gap={8}>
      <Icon icon={ArrowDownToLine} size={14} style={{ color: cssVar.colorTextQuaternary }} />
      <div className={styles.spacerLine} />
      <Text style={{ fontSize: 12 }} type={'secondary'}>
        {t('navPanel.bottomDivider' as any)}
      </Text>
      <div className={styles.spacerLine} />
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

  if (isSpacer(id)) {
    return (
      <Flexbox horizontal align={'center'} className={styles.overlay} gap={8}>
        <Icon icon={GripVertical} size={14} style={{ color: cssVar.colorTextQuaternary }} />
        <Icon icon={ArrowDownToLine} size={14} style={{ color: cssVar.colorTextQuaternary }} />
        <Text style={{ fontSize: 12 }} type={'secondary'}>
          {t('navPanel.bottomDivider' as any)}
        </Text>
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
const flattenItems = (outer: string[], inner: string[], bindSpacerToAccordion: boolean): string[] =>
  outer.flatMap((id) =>
    id === ACCORDION_GROUP_ID
      ? [...inner, ...(bindSpacerToAccordion ? [SIDEBAR_SPACER_ID] : [])]
      : [id],
  );

const CustomizeSidebarContent = memo(() => {
  const { close } = useModalContext();
  const { t: commonT } = useTranslation('common');
  const [storeItems, storeHiddenSections, updateSystemStatus] = useGlobalStore((s) => [
    systemStatusSelectors.sidebarItems(s),
    systemStatusSelectors.hiddenSidebarSections(s),
    s.updateSystemStatus,
  ]);
  const isWorkspaceMode = !!useActiveWorkspaceSlug();
  const sortableItemIds = useMemo(
    () => getSortableSidebarItemIds(isWorkspaceMode),
    [isWorkspaceMode],
  );
  const filteredStoreItems = useMemo(
    () => storeItems.filter((id) => sortableItemIds.has(id)),
    [storeItems, sortableItemIds],
  );

  // Local draft state — persisted only when the user confirms the modal.
  const [items, setItems] = useState<string[]>(filteredStoreItems);
  const [hiddenSections, setHiddenSections] = useState<string[]>(storeHiddenSections);
  const [shouldResetExpandedKeys, setShouldResetExpandedKeys] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Derive outer (with group placeholder) and inner (accordion items)
  const { bindSpacerToAccordion, innerItems, outerItems } = useMemo(() => {
    const hasAccordion = items.some(isAccordionKey);
    const shouldBindSpacer = hasAccordion && items.includes(SIDEBAR_SPACER_ID);
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
      } else if (isSpacer(id) && shouldBindSpacer) {
        continue;
      } else {
        outer.push(id);
      }
    }

    return { bindSpacerToAccordion: shouldBindSpacer, innerItems: inner, outerItems: outer };
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
      setHiddenSections(newHidden);
    },
    [hiddenSections],
  );

  const handleResetDefault = useCallback(() => {
    setItems(DEFAULT_SIDEBAR_ITEMS.filter((id) => sortableItemIds.has(id)));
    setHiddenSections(DEFAULT_HIDDEN_SECTIONS);
    setShouldResetExpandedKeys(true);
  }, [sortableItemIds]);

  const handleConfirm = useCallback(() => {
    updateSystemStatus(
      {
        hiddenSidebarSections: hiddenSections,
        sidebarItems: mergeAvailableSidebarItems(storeItems, items, sortableItemIds),
        ...(shouldResetExpandedKeys
          ? { sidebarExpandedKeys: DEFAULT_HOME_SIDEBAR_EXPANDED_KEYS }
          : {}),
      },
      'customizeSidebar',
    );
    close();
  }, [
    close,
    hiddenSections,
    items,
    shouldResetExpandedKeys,
    sortableItemIds,
    storeItems,
    updateSystemStatus,
  ]);

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
        next = flattenItems(
          outerItems,
          arrayMove(innerItems, oldIdx, newIdx),
          bindSpacerToAccordion,
        );
      } else {
        // Outer reorder (pages/community/... or the whole accordion group)
        const oldIdx = outerItems.indexOf(activeKey);
        const newIdx = outerItems.indexOf(overKey);
        if (oldIdx === -1 || newIdx === -1) return;
        next = flattenItems(
          arrayMove(outerItems, oldIdx, newIdx),
          innerItems,
          bindSpacerToAccordion,
        );
      }

      setItems(next);
    },
    [bindSpacerToAccordion, innerItems, outerItems],
  );

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
  }, []);

  const renderItem = (id: string) =>
    isSpacer(id) ? (
      <SpacerSortableItem key={id} />
    ) : (
      <SortableItem hiddenSections={hiddenSections} id={id} key={id} onToggle={toggleSection} />
    );

  return (
    <>
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
                  {bindSpacerToAccordion && <BoundSpacerItem />}
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
      <div className={styles.footer}>
        <Button
          block
          htmlType="button"
          icon={<Icon icon={RotateCcw} size={14} />}
          onClick={handleResetDefault}
        >
          {commonT('navPanel.resetDefault')}
        </Button>
        <Button block htmlType="button" type="primary" onClick={handleConfirm}>
          {commonT('confirm')}
        </Button>
      </div>
    </>
  );
});

// ---------------------------------------------------------------------------
// Modal entry
// ---------------------------------------------------------------------------

export const openCustomizeSidebarModal = (): ModalInstance =>
  createModal({
    content: <CustomizeSidebarContent />,
    footer: null,
    maskClosable: true,
    title: t('navPanel.customizeSidebar', { ns: 'common' }),
    width: 360,
  });

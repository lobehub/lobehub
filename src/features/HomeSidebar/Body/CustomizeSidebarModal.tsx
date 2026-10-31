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
import { Flexbox, Icon, Tooltip } from '@lobehub/ui';
import {
  ActionIcon,
  Button,
  createModal,
  type ModalInstance,
  Text,
  useModalContext,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { t } from 'i18next';
import { ArrowDownToLine, Eye, EyeOff, GripVertical, PinIcon, RotateCcw } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { getRouteById } from '@/config/routes';
import { useGlobalStore } from '@/store/global';
import { DEFAULT_HOME_SIDEBAR_EXPANDED_KEYS } from '@/store/global/initialState';
import { systemStatusSelectors } from '@/store/global/selectors';
import {
  DEFAULT_SIDEBAR_ITEMS,
  getDefaultHiddenSections,
  SIDEBAR_ACCORDION_KEYS,
  SIDEBAR_SPACER_ID,
} from '@/store/global/selectors/systemStatus';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

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
  { id: 'goals', labelKey: 'tab.goals', routeId: 'goals' },
  { id: 'dashboard', labelKey: 'tab.dashboard', routeId: 'dashboard' },
  { id: 'favorites', labelKey: 'favorite.section' },
  { id: 'recents', labelKey: 'recents' },
  { id: 'project', labelKey: 'project:sidebar.title' },
  { id: 'private', labelKey: 'navPanel.privateAgents' },
  { alwaysVisible: true, id: 'agent', labelKey: 'navPanel.agent' },
  { id: 'image', labelKey: 'tab.generation', routeId: 'image' },
  { id: 'community', labelKey: 'tab.community', routeId: 'community' },
  { id: 'resource', labelKey: 'tab.resource', routeId: 'resource' },
  { id: 'memory', labelKey: 'tab.memory', routeId: 'memory' },
];

// Private is workspace-only; in personal mode every row is implicitly
// owner-private, so hide it from the customizer where toggling it on
// would render an empty accordion no user can populate.
// Dashboards also stay out until the `dashboard` feature flag is on for the
// user, and Goals until the user turns on its lab; a dropped id is restored by
// `withAllKnownKeys` once it is.
export const getAvailableSidebarItems = (
  isWorkspaceMode: boolean,
  {
    dashboardEnabled = false,
    goalsEnabled = false,
  }: { dashboardEnabled?: boolean; goalsEnabled?: boolean } = {},
): SidebarItemConfig[] =>
  ALL_SIDEBAR_ITEMS.filter((item) => {
    if (item.id === 'dashboard' && !dashboardEnabled) return false;
    if (item.id === 'goals' && !goalsEnabled) return false;
    if (isWorkspaceMode && (item.id === 'memory' || item.id === 'dashboard')) return false;
    if (!isWorkspaceMode && item.id === 'private') return false;
    return true;
  });

export const getSortableSidebarItemIds = (
  isWorkspaceMode: boolean,
  options?: { dashboardEnabled?: boolean; goalsEnabled?: boolean },
): Set<string> =>
  new Set([
    ...getAvailableSidebarItems(isWorkspaceMode, options).map((item) => item.id),
    SIDEBAR_SPACER_ID,
  ]);

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

const styles = stylex.create({
  accordionGroup: {
    marginInline: '-5px',
    padding: '4px',
    borderWidth: '1px',
    borderStyle: 'dashed',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadius,
  },
  item: {
    height: '40px',
    paddingInline: '8px',
    borderRadius: cssVar.borderRadius,
    transition: 'background 0.2s ease-in-out',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  itemDragging: { opacity: 0 },
  overlay: {
    height: '40px',
    paddingInline: '8px',
    borderRadius: cssVar.borderRadius,
    backgroundColor: cssVar.colorBgElevated,
    backgroundImage: 'none',
    boxShadow: cssVar.boxShadowSecondary,
  },
  spacerLine: {
    flex: '1',
    blockSize: '1px',
    backgroundColor: cssVar.colorBorderSecondary,
    backgroundImage: 'none',
  },
  footer: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: '8px',
    paddingBlockStart: '16px',
  },
});

// ---------------------------------------------------------------------------
// SortableItem
// ---------------------------------------------------------------------------

const SortableItem = memo<{
  hiddenSections: string[];
  id: string;
  onToggle: (key: string) => void;
}>(({ id, hiddenSections, onToggle }) => {
  const { t } = useTranslation('common');
  const isWorkspaceMode = !!useActiveWorkspaceSlug();
  const item = ITEM_MAP.get(id);
  // In workspace mode the Agent bucket pairs with Private, so the label
  // switches to "Public" — mirroring the sidebar header.
  const labelKey =
    item?.id === 'agent' && isWorkspaceMode ? 'navPanel.publicAgents' : item?.labelKey;
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
      gap={4}
      justify={'space-between'}
      ref={setNodeRef}
      className={
        isDragging
          ? stylex.props(styles.item, styles.itemDragging).className
          : stylex.props(styles.item).className
      }
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
        <Text>{t(labelKey as any)}</Text>
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
      gap={8}
      ref={setNodeRef}
      className={
        isDragging
          ? stylex.props(styles.item, styles.itemDragging).className
          : stylex.props(styles.item).className
      }
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
      <div {...stylex.props(styles.spacerLine)} />
      <Text style={{ fontSize: 12 }} type={'secondary'}>
        {t('navPanel.bottomDivider' as any)}
      </Text>
      <div {...stylex.props(styles.spacerLine)} />
    </Flexbox>
  );
});

const BoundSpacerItem = memo(() => {
  const { t } = useTranslation('common');

  return (
    <Flexbox horizontal align={'center'} className={stylex.props(styles.item).className} gap={8}>
      <Icon icon={ArrowDownToLine} size={14} style={{ color: cssVar.colorTextQuaternary }} />
      <div {...stylex.props(styles.spacerLine)} />
      <Text style={{ fontSize: 12 }} type={'secondary'}>
        {t('navPanel.bottomDivider' as any)}
      </Text>
      <div {...stylex.props(styles.spacerLine)} />
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
      className={stylex.props(styles.accordionGroup).className}
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
  const isWorkspaceMode = !!useActiveWorkspaceSlug();
  const agentLabelKey = isWorkspaceMode ? 'navPanel.publicAgents' : 'navPanel.agent';

  // Accordion group overlay: render a compact representation
  if (id === ACCORDION_GROUP_ID) {
    return (
      <Flexbox
        horizontal
        align={'center'}
        className={stylex.props(styles.overlay).className}
        gap={8}
      >
        <Icon icon={GripVertical} size={14} style={{ color: cssVar.colorTextQuaternary }} />
        <Text>{t(agentLabelKey as any)}</Text>
        <Text type={'secondary'}>+ {t('recents' as any)}</Text>
      </Flexbox>
    );
  }

  if (isSpacer(id)) {
    return (
      <Flexbox
        horizontal
        align={'center'}
        className={stylex.props(styles.overlay).className}
        gap={8}
      >
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
  const labelKey = item.id === 'agent' ? agentLabelKey : item.labelKey;

  return (
    <Flexbox horizontal align={'center'} className={stylex.props(styles.overlay).className} gap={8}>
      <Icon icon={GripVertical} size={14} style={{ color: cssVar.colorTextQuaternary }} />
      {route?.icon && <Icon icon={route.icon} size={18} />}
      <Text>{t(labelKey as any)}</Text>
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
  const activeWorkspaceId = useActiveWorkspaceId();
  const storeItems = useGlobalStore(systemStatusSelectors.sidebarItems(activeWorkspaceId));
  const storeHiddenSections = useGlobalStore(
    systemStatusSelectors.hiddenSidebarSections(activeWorkspaceId),
  );
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);
  const isWorkspaceMode = !!useActiveWorkspaceSlug();
  const dashboardEnabled = useServerConfigStore(serverConfigSelectors.enableDashboard);
  const goalsEnabled = useUserStore(labPreferSelectors.enableGoals);
  const sortableItemIds = useMemo(
    () => getSortableSidebarItemIds(isWorkspaceMode, { dashboardEnabled, goalsEnabled }),
    [isWorkspaceMode, dashboardEnabled, goalsEnabled],
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
    setHiddenSections(getDefaultHiddenSections(isWorkspaceMode));
    setShouldResetExpandedKeys(true);
  }, [sortableItemIds, isWorkspaceMode]);

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
      <div {...stylex.props(styles.footer)}>
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

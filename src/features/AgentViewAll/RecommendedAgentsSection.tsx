'use client';

import { closestCenter, DndContext, type DragEndEvent, useSensor, useSensors } from '@dnd-kit/core';
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { SidebarAgentItem } from '@lobechat/types';
import { ActionIcon, cssVar, Flexbox, Icon, Text, toast } from '@lobehub/ui';
import { CheckIcon, ChevronDownIcon, ChevronUpIcon, PlusIcon } from 'lucide-react';
import { memo, type MouseEvent, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  RowKeyboardSensor,
  RowMouseSensor,
  RowTouchSensor,
  suppressNextClick,
} from '@/features/HomeSidebar/Body/sortableRow';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useHomeStore } from '@/store/home';

import { agentSectionStyles, SidebarMiniCard } from './SidebarAgentsSection';

interface RecommendedCardProps {
  isListed: (item: SidebarAgentItem) => boolean;
  item: SidebarAgentItem;
  onToggleSidebar: (item: SidebarAgentItem) => void;
}

/** A recommended Agent with a one-click "add to my sidebar" toggle. */
const RecommendedCard = memo<RecommendedCardProps>(({ isListed, item, onToggleSidebar }) => {
  const { t } = useTranslation('common');
  const listed = isListed(item);

  const handleToggle = useCallback(
    (event: MouseEvent) => {
      // The card is a link to the Agent; the button only toggles the sidebar.
      event.preventDefault();
      event.stopPropagation();
      onToggleSidebar(item);
    },
    [item, onToggleSidebar],
  );

  return (
    <SidebarMiniCard
      item={item}
      listed={listed}
      extra={
        <ActionIcon
          data-row-action
          active={listed}
          icon={listed ? CheckIcon : PlusIcon}
          size={'small'}
          title={listed ? t('agentViewAll.removeFromSidebar') : t('agentViewAll.addToSidebar')}
          onClick={handleToggle}
        />
      }
      onToggleSidebar={onToggleSidebar}
    />
  );
});

RecommendedCard.displayName = 'RecommendedCard';

const SortableCard = memo<RecommendedCardProps>((props) => {
  const { attributes, isDragging, listeners, setNodeRef, transform, transition } = useSortable({
    id: props.item.id,
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        opacity: isDragging ? 0.4 : undefined,
        transform: CSS.Translate.toString(transform),
        transition,
        userSelect: 'none',
      }}
      {...attributes}
      {...listeners}
      onDragStart={(event) => event.preventDefault()}
    >
      <RecommendedCard {...props} />
    </div>
  );
});

SortableCard.displayName = 'SortableRecommendedCard';

interface RecommendedAgentsSectionProps {
  /** Owners/admins arrange the list; everyone else only reads it. */
  canEdit: boolean;
  isListed: (item: SidebarAgentItem) => boolean;
  /** The recommended Agents / chat groups that still exist, in order. */
  items: SidebarAgentItem[];
  onToggleSidebar: (item: SidebarAgentItem) => void;
}

/**
 * "Recommended agents" on top of the Agents page: the Agents owners/admins
 * recommend to every member of the workspace. New members start with them in
 * their sidebar (unpinned); anyone can add one to their sidebar from here.
 * Owners/admins drag the cards to reorder and add / remove Agents from an
 * Agent's menu ("Add to recommended agents").
 */
const RecommendedAgentsSection = memo<RecommendedAgentsSectionProps>(
  ({ canEdit, isListed, items, onToggleSidebar }) => {
    const { t } = useTranslation('common');
    const updateRecommendedAgents = useHomeStore((s) => s.updateRecommendedAgents);
    const collapsed = useGlobalStore(systemStatusSelectors.agentListRecommendedSectionCollapsed);
    const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);
    const toggleCollapsed = useCallback(
      () =>
        updateSystemStatus(
          { agentListRecommendedSectionCollapsed: !collapsed },
          'toggleAgentListRecommendedSection',
        ),
      [collapsed, updateSystemStatus],
    );
    const ids = useMemo(() => items.map((item) => item.id), [items]);

    const sensors = useSensors(
      useSensor(RowMouseSensor, { activationConstraint: { distance: 5 } }),
      useSensor(RowTouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
      useSensor(RowKeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    );

    const handleDragEnd = useCallback(
      async ({ active, over }: DragEndEvent) => {
        suppressNextClick();
        if (!over || active.id === over.id) return;

        const next = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
        try {
          await updateRecommendedAgents(next);
        } catch (error) {
          console.error('[agents] failed to save the recommended order', error);
          toast.error(t('operationFailed'));
        }
      },
      [ids, t, updateRecommendedAgents],
    );

    const cardProps = { isListed, onToggleSidebar };

    return (
      <Flexbox className={agentSectionStyles.container} data-testid={'recommended-agents'} gap={12}>
        <Flexbox
          horizontal
          align={'center'}
          className={agentSectionStyles.header}
          gap={8}
          justify={'space-between'}
          onClick={toggleCollapsed}
        >
          <Flexbox horizontal align={'center'} gap={8}>
            <Text fontSize={13} weight={500}>
              {t('agentViewAll.recommendedSection.title')}
            </Text>
            <Text fontSize={12} type={'secondary'}>
              {items.length}
            </Text>
          </Flexbox>
          <Flexbox horizontal align={'center'} flex={'none'} gap={4}>
            <Text fontSize={12} type={'secondary'}>
              {collapsed
                ? t('agentViewAll.sidebarSection.expand')
                : t('agentViewAll.sidebarSection.collapse')}
            </Text>
            <Icon
              color={cssVar.colorTextSecondary}
              icon={collapsed ? ChevronDownIcon : ChevronUpIcon}
              size={14}
            />
          </Flexbox>
        </Flexbox>
        {collapsed ? null : items.length === 0 ? (
          <Text fontSize={12} type={'secondary'}>
            {t('agentViewAll.recommendedSection.empty')}
          </Text>
        ) : canEdit ? (
          <DndContext
            collisionDetection={closestCenter}
            sensors={sensors}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={ids} strategy={rectSortingStrategy}>
              <div className={agentSectionStyles.grid}>
                {items.map((item) => (
                  <SortableCard item={item} key={item.id} {...cardProps} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        ) : (
          <div className={agentSectionStyles.grid}>
            {items.map((item) => (
              <RecommendedCard item={item} key={item.id} {...cardProps} />
            ))}
          </div>
        )}
      </Flexbox>
    );
  },
);

RecommendedAgentsSection.displayName = 'RecommendedAgentsSection';

export default RecommendedAgentsSection;

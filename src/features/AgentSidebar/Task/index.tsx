'use client';

import {
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  AccordionRoot,
  accordionStyles,
  AccordionTrigger,
  ActionIcon,
  cx,
  Flexbox,
  Text,
} from '@lobehub/ui';
import { ArrowRight } from 'lucide-react';
import { memo, type MouseEvent, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import SectionTitle, { useSectionTriggerStyle } from '@/features/NavPanel/components/SectionTitle';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useAgentStore } from '@/store/agent';

import StatusGroup from './StatusGroup';
import { useSidebarTaskGroups } from './useSidebarTaskGroups';

interface TaskListProps {
  itemKey: string;
}

const TaskList = memo<TaskListProps>(({ itemKey }) => {
  const sectionTriggerStyle = useSectionTriggerStyle();
  const { t } = useTranslation('chat');
  const navigate = useWorkspaceAwareNavigate();
  const agentId = useAgentStore((s) => s.activeAgentId);

  const { groups: orderedGroups, isLoading } = useSidebarTaskGroups(agentId);

  const totalTasks = useMemo(
    () => orderedGroups.reduce((acc, g) => acc + g.tasks.length, 0),
    [orderedGroups],
  );

  const handleViewAll = useCallback(
    (e: MouseEvent) => {
      // Stop the click from toggling the accordion header.
      e.stopPropagation();
      if (agentId) navigate(`/agent/${agentId}/tasks`);
    },
    [agentId, navigate],
  );

  const titleNode = (
    <Flexbox horizontal align="center" gap={4}>
      <SectionTitle>{t('tab.tasks')}</SectionTitle>
      {totalTasks > 0 && (
        <Text fontSize={11} type="secondary">
          {totalTasks}
        </Text>
      )}
    </Flexbox>
  );

  const actionNode = (
    <ActionIcon
      icon={ArrowRight}
      size={'small'}
      title={t('taskList.viewAll')}
      onClick={handleViewAll}
    />
  );

  const header = (
    <AccordionHeader>
      <AccordionTrigger style={sectionTriggerStyle}>{titleNode}</AccordionTrigger>
      <div
        className={cx('accordion-action', accordionStyles.action, accordionStyles.actionBorderless)}
      >
        {actionNode}
      </div>
    </AccordionHeader>
  );

  if (isLoading && orderedGroups.length === 0) {
    return (
      <AccordionItem value={itemKey}>
        {header}
        <AccordionPanel contentStyle={{ padding: 0 }}>
          <SkeletonList />
        </AccordionPanel>
      </AccordionItem>
    );
  }

  return (
    <AccordionItem value={itemKey}>
      {header}
      <AccordionPanel contentStyle={{ padding: 0 }}>
        {orderedGroups.length === 0 ? (
          <Text fontSize={12} style={{ padding: '8px 12px' }} type="secondary">
            {t('taskList.kanban.emptyColumn')}
          </Text>
        ) : (
          <AccordionRoot
            defaultValue={orderedGroups.map((g) => g.key)}
            indicatorPlacement="inline"
            style={{ gap: 2 }}
          >
            {orderedGroups.map((group) => (
              <StatusGroup group={group} key={group.key} />
            ))}
          </AccordionRoot>
        )}
      </AccordionPanel>
    </AccordionItem>
  );
});

export default TaskList;

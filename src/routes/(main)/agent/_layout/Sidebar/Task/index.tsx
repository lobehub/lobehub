'use client';

import { Accordion, AccordionItem, Flexbox, Text } from '@lobehub/ui';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useClientDataSWR } from '@/libs/swr';
import { taskService } from '@/services/task';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import type { TaskGroupItem } from '@/store/task/slices/list/initialState';

import StatusGroup from './StatusGroup';

const SIDEBAR_GROUPS = [
  { key: 'needsInput', statuses: ['paused', 'failed'] },
  { key: 'backlog', statuses: ['backlog'] },
  { key: 'running', statuses: ['running', 'scheduled'] },
];
const STATUS_ORDER = SIDEBAR_GROUPS.map((g) => g.key);

const FETCH_SIDEBAR_TASK_GROUPS_KEY = 'fetchSidebarTaskGroups';

interface TaskListProps {
  itemKey: string;
}

const TaskList = memo<TaskListProps>(({ itemKey }) => {
  const { t } = useTranslation('chat');
  const agentId = useAgentStore((s) => s.activeAgentId);
  const isHeterogeneous = useAgentStore(agentSelectors.isCurrentAgentHeterogeneous);

  const enabled = !isHeterogeneous && !!agentId;
  const { data, isLoading } = useClientDataSWR<{ data: TaskGroupItem[]; success: boolean }>(
    enabled ? [FETCH_SIDEBAR_TASK_GROUPS_KEY, agentId] : null,
    async ([, id]: [string, string]) =>
      taskService.groupList({ assigneeAgentId: id, groups: SIDEBAR_GROUPS }),
    {
      fallbackData: { data: [], success: true },
      revalidateOnFocus: false,
    },
  );
  const taskGroups = data?.data ?? [];

  const orderedGroups = useMemo(() => {
    const map = new Map(taskGroups.map((g) => [g.key, g]));
    return STATUS_ORDER.map((key) => map.get(key)).filter(
      (g): g is NonNullable<typeof g> => !!g && g.tasks.length > 0,
    );
  }, [taskGroups]);

  const totalTasks = useMemo(
    () => orderedGroups.reduce((acc, g) => acc + g.tasks.length, 0),
    [orderedGroups],
  );

  if (isHeterogeneous) return null;

  const titleNode = (
    <Flexbox horizontal align="center" gap={4}>
      <Text ellipsis fontSize={12} type={'secondary'} weight={500}>
        {t('tab.tasks')}
      </Text>
      {totalTasks > 0 && (
        <Text fontSize={11} type="secondary">
          {totalTasks}
        </Text>
      )}
    </Flexbox>
  );

  if (isLoading && taskGroups.length === 0) {
    return (
      <AccordionItem itemKey={itemKey} paddingBlock={4} paddingInline={'8px 4px'} title={titleNode}>
        <SkeletonList />
      </AccordionItem>
    );
  }

  return (
    <AccordionItem itemKey={itemKey} paddingBlock={4} paddingInline={'8px 4px'} title={titleNode}>
      {orderedGroups.length === 0 ? (
        <Text fontSize={12} style={{ padding: '8px 12px' }} type="secondary">
          {t('taskList.kanban.emptyColumn')}
        </Text>
      ) : (
        <Accordion defaultExpandedKeys={orderedGroups.map((g) => g.key)} gap={2}>
          {orderedGroups.map((group) => (
            <StatusGroup group={group} key={group.key} />
          ))}
        </Accordion>
      )}
    </AccordionItem>
  );
});

export default TaskList;

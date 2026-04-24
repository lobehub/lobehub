import { Accordion, AccordionItem, Block, Center, Empty, Flexbox, Icon, Text } from '@lobehub/ui';
import { Divider } from 'antd';
import { cssVar } from 'antd-style';
import { ClipboardCheckIcon, UserRound } from 'lucide-react';
import { Fragment, memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useTaskStore } from '@/store/task';
import { taskListSelectors } from '@/store/task/selectors';

import AgentTaskItem from '../features/AgentTaskItem';
import AssigneeAvatar from '../features/AssigneeAvatar';
import PriorityHighIcon from '../features/icons/PriorityHighIcon';
import PriorityLowIcon from '../features/icons/PriorityLowIcon';
import PriorityMediumIcon from '../features/icons/PriorityMediumIcon';
import PriorityNoneIcon from '../features/icons/PriorityNoneIcon';
import PriorityUrgentIcon from '../features/icons/PriorityUrgentIcon';
import TaskStatusIcon from '../features/TaskStatusIcon';
import { useAgentDisplayMeta } from '../shared/useAgentDisplayMeta';
import type { TaskGroupBy, TaskGroupMeta, TaskListViewOptions } from './listViewOptions';
import {
  compareTaskItems,
  getTaskGroupMeta,
  HIDDEN_WHEN_COMPLETED_STATUSES,
  sortGroupEntries,
} from './listViewOptions';

interface TaskListProps {
  onShowHiddenCompleted?: () => void;
  options: TaskListViewOptions;
}

const HIDDEN_COMPLETED_STATUS_SET = new Set<string>(HIDDEN_WHEN_COMPLETED_STATUSES);

const renderTaskRows = (items: ReturnType<typeof taskListSelectors.taskList>, sub?: boolean) =>
  items.map((task, index) => (
    <Fragment key={task.identifier}>
      <AgentTaskItem task={task} />
      {!sub && index !== items.length - 1 && <Divider dashed style={{ margin: 0 }} />}
    </Fragment>
  ));

const renderTaskListBlock = (
  items: ReturnType<typeof taskListSelectors.taskList>,
  sub?: boolean,
) => (
  <Block gap={sub ? 0 : 2} padding={2} variant={'borderless'}>
    {renderTaskRows(items, sub)}
  </Block>
);

const PRIORITY_ICON_MAP = {
  0: PriorityNoneIcon,
  1: PriorityUrgentIcon,
  2: PriorityHighIcon,
  3: PriorityMediumIcon,
  4: PriorityLowIcon,
} as const;

const TASK_GROUP_BY_VALUES = new Set<TaskGroupBy>(['assignee', 'none', 'priority', 'status']);

const normalizeGroupBy = (value: TaskGroupBy | string | undefined, fallback: TaskGroupBy) => {
  if (!value) return fallback;
  return TASK_GROUP_BY_VALUES.has(value as TaskGroupBy) ? (value as TaskGroupBy) : fallback;
};

const AssigneeLabel = memo<{ agentId: string }>(({ agentId }) => {
  const displayMeta = useAgentDisplayMeta(agentId);
  return <>{displayMeta?.title}</>;
});

const renderGroupPrefix = (group: TaskGroupMeta) => {
  if (group.groupBy === 'assignee') {
    if (group.assigneeId) {
      return <AssigneeAvatar agentId={group.assigneeId} size={18} />;
    }
    return <Icon icon={UserRound} size={14} />;
  }

  if (group.groupBy === 'priority') {
    const priority = group.priority ?? 0;
    const PriorityIcon =
      PRIORITY_ICON_MAP[priority as keyof typeof PRIORITY_ICON_MAP] || PriorityNoneIcon;
    return (
      <PriorityIcon
        color={priority === 1 ? cssVar.orange : cssVar.colorTextDescription}
        size={16}
      />
    );
  }

  if (group.groupBy === 'status') {
    const status = group.status ?? 'backlog';

    return <TaskStatusIcon size={16} status={status} />;
  }

  return null;
};

const renderGroupTitle = (group: TaskGroupMeta, count: number, sub?: boolean) => (
  <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
    <Flexbox horizontal align={'center'} flex={'none'} gap={6} style={{ overflow: 'hidden' }}>
      {renderGroupPrefix(group)}
      <Text ellipsis weight={500}>
        {group.assigneeId ? <AssigneeLabel agentId={group.assigneeId} /> : group.label}
      </Text>
    </Flexbox>
    <Text fontSize={12} type={'secondary'}>
      {count}
    </Text>
    {sub ? (
      <Divider style={{ margin: 0, borderColor: cssVar.colorBorder }} />
    ) : (
      <Flexbox flex={1} />
    )}
  </Flexbox>
);

const TaskList = memo<TaskListProps>(({ onShowHiddenCompleted, options }) => {
  const { t } = useTranslation('chat');
  const tasks = useTaskStore(taskListSelectors.taskList);
  const isInit = useTaskStore(taskListSelectors.isTaskListInit);
  const groupBy = normalizeGroupBy(options.groupBy, 'status');
  const subGroupBy = normalizeGroupBy(options.subGroupBy, 'none');
  const effectiveSubGroupBy = groupBy === 'none' ? 'none' : subGroupBy;
  const visibleTasks = useMemo(
    () =>
      options.hideCompleted
        ? tasks.filter((task) => !HIDDEN_COMPLETED_STATUS_SET.has(task.status))
        : tasks,
    [tasks, options.hideCompleted],
  );
  const hiddenCount = tasks.length - visibleTasks.length;
  const groupedTaskEntries = useMemo(() => {
    const sortedTasks = [...visibleTasks].sort((a, b) => compareTaskItems(a, b, options));
    const primaryGroupOrderDirection =
      options.orderBy === groupBy ? options.orderDirection : undefined;
    const subGroupOrderDirection =
      options.orderBy === effectiveSubGroupBy ? options.orderDirection : undefined;

    const primaryGroupMap = new Map<string, { items: typeof visibleTasks; meta: TaskGroupMeta }>();
    for (const task of sortedTasks) {
      const primaryGroup = getTaskGroupMeta(task, groupBy);
      if (!primaryGroup?.key) continue;
      const bucket = primaryGroupMap.get(primaryGroup.key);

      if (bucket) {
        bucket.items.push(task);
      } else {
        primaryGroupMap.set(primaryGroup.key, { items: [task], meta: primaryGroup });
      }
    }

    const primaryGroups = sortGroupEntries(
      [...primaryGroupMap.values()].map((group) => [group.meta, group.items]),
      groupBy,
      primaryGroupOrderDirection,
    );

    return primaryGroups.map(([meta, groupedTasks]) => {
      if (effectiveSubGroupBy === 'none') {
        return {
          items: groupedTasks,
          meta,
          subGroups: [] as Array<[TaskGroupMeta, typeof visibleTasks]>,
        };
      }

      const subGroupMap = new Map<string, { items: typeof visibleTasks; meta: TaskGroupMeta }>();
      for (const task of groupedTasks) {
        const subGroup = getTaskGroupMeta(task, effectiveSubGroupBy);
        if (!subGroup?.key) continue;
        const bucket = subGroupMap.get(subGroup.key);

        if (bucket) {
          bucket.items.push(task);
        } else {
          subGroupMap.set(subGroup.key, { items: [task], meta: subGroup });
        }
      }

      return {
        items: groupedTasks,
        meta,
        subGroups: sortGroupEntries(
          [...subGroupMap.values()].map((group) => [group.meta, group.items]),
          effectiveSubGroupBy,
          subGroupOrderDirection,
        ),
      };
    });
  }, [effectiveSubGroupBy, groupBy, options, visibleTasks]);

  if (!isInit) return null;

  if (tasks.length === 0) {
    return (
      <Center height={'80vh'} width={'100%'}>
        <Empty description={t('taskList.empty')} icon={ClipboardCheckIcon} />
      </Center>
    );
  }

  const hiddenFooter = hiddenCount > 0 && (
    <Flexbox
      horizontal
      align={'center'}
      gap={16}
      justify={'center'}
      paddingBlock={16}
      style={{ fontSize: 13 }}
    >
      <Flexbox horizontal align={'center'} gap={6}>
        <Text weight={500}>{t('taskList.hiddenCompleted.count', { count: hiddenCount })}</Text>
        <Text type={'secondary'}>{t('taskList.hiddenCompleted.suffix')}</Text>
      </Flexbox>
      {onShowHiddenCompleted && (
        <Text style={{ cursor: 'pointer' }} weight={500} onClick={onShowHiddenCompleted}>
          {t('taskList.hiddenCompleted.show')}
        </Text>
      )}
    </Flexbox>
  );

  if (groupBy === 'none') {
    return (
      <>
        {renderTaskListBlock(groupedTaskEntries[0]?.items ?? [])}
        {hiddenFooter}
      </>
    );
  }

  return (
    <>
      <Accordion gap={16}>
        {groupedTaskEntries.map((group) => {
          return (
            <AccordionItem
              defaultExpand
              indicatorPlacement={'end'}
              itemKey={`group-${group.meta.key}`}
              key={group.meta.key}
              paddingBlock={8}
              paddingInline={14}
              title={renderGroupTitle(group.meta, group.items.length)}
              variant={'filled'}
              styles={{
                header: { marginBottom: 8 },
              }}
            >
              {group.subGroups.length > 0 ? (
                <Accordion gap={6}>
                  {group.subGroups.map(([subGroup, subGroupTasks]) => (
                    <AccordionItem
                      defaultExpand
                      indicatorPlacement={'end'}
                      itemKey={`sub-${group.meta.key}-${subGroup.key}`}
                      key={`${group.meta.key}-${subGroup.key}`}
                      paddingBlock={6}
                      paddingInline={14}
                      title={renderGroupTitle(subGroup, subGroupTasks.length, true)}
                    >
                      {renderTaskListBlock(subGroupTasks, true)}
                    </AccordionItem>
                  ))}
                </Accordion>
              ) : (
                renderTaskListBlock(group.items)
              )}
            </AccordionItem>
          );
        })}
      </Accordion>
      {hiddenFooter}
    </>
  );
});

export default TaskList;

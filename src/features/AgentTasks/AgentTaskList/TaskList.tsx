import { Accordion, AccordionItem, Block, Center, Empty, Flexbox } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { Divider } from 'antd';
import { cssVar } from 'antd-style';
import { ClipboardCheckIcon } from 'lucide-react';
import { Fragment, memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import { useTaskStore } from '@/store/task';
import { taskListSelectors } from '@/store/task/selectors';
import type { TaskListItem } from '@/store/task/slices/list/initialState';

import type { TaskItemRouteScope } from '../features/AgentTaskItem';
import AgentTaskItem from '../features/AgentTaskItem';
import type { TaskGroupBy, TaskGroupMeta, TaskListViewOptions, TaskRow } from './listViewOptions';
import {
  buildTaskRows,
  collapseSubTasks,
  compareTaskItems,
  groupTaskItems,
  HIDDEN_WHEN_COMPLETED_STATUSES,
} from './listViewOptions';
import TaskGroupLabel from './TaskGroupLabel';
import TaskItemSkeleton from './TaskItemSkeleton';
import TaskRowIndent from './TaskRowIndent';

interface TaskListProps {
  /**
   * Settled signal — truthy once the current scope's list has loaded into the
   * store, `undefined` while unsettled. Derived from the store's
   * `isTaskListInit` (not raw SWR `data`) so it resets in lockstep with `tasks`
   * on a scope/visibility switch and never disagrees with the empty signal.
   */
  data?: unknown;
  emptyDescription?: string;
  /** Thrown error from the list SWR — surfaced as a failure state, not a skeleton. */
  error?: unknown;
  /** First-load / retry in flight (SWR `isLoading`). */
  isLoading?: boolean;
  /** Optional list source for alternate task collections such as scheduled tasks. */
  items?: TaskListItem[];
  onRetry?: () => void;
  onShowHiddenCompleted?: () => void;
  options: TaskListViewOptions;
  routeScope?: TaskItemRouteScope;
}

const HIDDEN_COMPLETED_STATUS_SET = new Set<string>(HIDDEN_WHEN_COMPLETED_STATUSES);

const renderTaskRows = (rows: TaskRow[], sub?: boolean, routeScope?: TaskItemRouteScope) =>
  rows.map((row, index) => {
    // A nested child belongs to the row above it, so no rule is drawn between
    // them — the divider only separates one top-level task from the next.
    const showDivider = !sub && rows[index + 1] && rows[index + 1].depth === 0;

    return (
      <Fragment key={`${row.isParentContext ? 'context:' : ''}${row.task.identifier}`}>
        <TaskRowIndent depth={row.depth} muted={row.isParentContext}>
          <AgentTaskItem routeScope={routeScope} task={row.task} />
        </TaskRowIndent>
        {showDivider && <Divider dashed style={{ margin: 0 }} />}
      </Fragment>
    );
  });

const renderTaskListBlock = (rows: TaskRow[], sub?: boolean, routeScope?: TaskItemRouteScope) => (
  <Block gap={sub ? 0 : 2} padding={2} variant={'borderless'}>
    {renderTaskRows(rows, sub, routeScope)}
  </Block>
);

const TASK_GROUP_BY_VALUES = new Set<TaskGroupBy>([
  'assignee',
  'automationMode',
  'member',
  'none',
  'priority',
  'status',
]);

const normalizeGroupBy = (value: TaskGroupBy | string | undefined, fallback: TaskGroupBy) => {
  if (!value) return fallback;
  return TASK_GROUP_BY_VALUES.has(value as TaskGroupBy) ? (value as TaskGroupBy) : fallback;
};

const renderGroupTitle = (group: TaskGroupMeta, count: number, sub?: boolean) => (
  <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
    <TaskGroupLabel group={group} />
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

const TaskList = memo<TaskListProps>((props) => {
  const { data, error, isLoading, items, onRetry, onShowHiddenCompleted, options, routeScope } =
    props;
  const { t } = useTranslation('chat');
  const storeTasks = useTaskStore(taskListSelectors.taskList);
  const tasks = items ?? storeTasks;
  const groupBy = normalizeGroupBy(options.groupBy, 'status');
  const subGroupBy = normalizeGroupBy(options.subGroupBy, 'none');
  const effectiveSubGroupBy = groupBy === 'none' ? 'none' : subGroupBy;
  const unfinishedTasks = useMemo(
    () =>
      options.hideCompleted
        ? tasks.filter((task) => !HIDDEN_COMPLETED_STATUS_SET.has(task.status))
        : tasks,
    [tasks, options.hideCompleted],
  );
  // Only the completed/canceled cut feeds the "hidden by display options"
  // footer — its "Show" action clears `hideCompleted`, so folding the sub-task
  // count in would promise a reveal that toggle doesn't deliver.
  const hiddenCount = tasks.length - unfinishedTasks.length;
  const visibleTasks = useMemo(
    () => (options.showSubTasks ? unfinishedTasks : collapseSubTasks(unfinishedTasks)),
    [options.showSubTasks, unfinishedTasks],
  );
  // Keyed off the full list, not the visible one: a nested child's parent may
  // sit in another group, or be hidden by the display options, and still has to
  // resolve into a context row.
  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const nested = options.showSubTasks && options.nestedSubTasks;
  const groupedTaskEntries = useMemo(() => {
    const compare = (a: (typeof visibleTasks)[number], b: (typeof visibleTasks)[number]) =>
      compareTaskItems(a, b, options);
    const toRows = (items: typeof visibleTasks) =>
      buildTaskRows(items, { compare, nested, taskById });
    const sortedTasks = [...visibleTasks].sort(compare);
    const primaryGroupOrderDirection =
      options.orderBy === groupBy ? options.orderDirection : undefined;
    const subGroupOrderDirection =
      options.orderBy === effectiveSubGroupBy ? options.orderDirection : undefined;

    const primaryGroups = groupTaskItems(sortedTasks, groupBy, primaryGroupOrderDirection);

    return primaryGroups.map(([meta, groupedTasks]) => {
      if (effectiveSubGroupBy === 'none') {
        return {
          count: groupedTasks.length,
          meta,
          rows: toRows(groupedTasks),
          subGroups: [] as Array<{ count: number; meta: TaskGroupMeta; rows: TaskRow[] }>,
        };
      }

      return {
        count: groupedTasks.length,
        meta,
        rows: toRows(groupedTasks),
        subGroups: groupTaskItems(groupedTasks, effectiveSubGroupBy, subGroupOrderDirection).map(
          ([subMeta, subItems]) => ({
            count: subItems.length,
            meta: subMeta,
            rows: toRows(subItems),
          }),
        ),
      };
    });
  }, [effectiveSubGroupBy, groupBy, nested, options, taskById, visibleTasks]);

  const skeleton = (
    <Block gap={2} padding={2} variant={'borderless'}>
      {Array.from({ length: 5 }).map((_, index) => (
        <Fragment key={`task-skeleton-${index}`}>
          <TaskItemSkeleton />
          {index !== 4 && <Divider dashed style={{ margin: 0 }} />}
        </Fragment>
      ))}
    </Block>
  );

  const emptyState = (
    <Center height={'80vh'} width={'100%'}>
      <Empty
        description={props.emptyDescription ?? t('taskList.empty')}
        icon={ClipboardCheckIcon}
      />
    </Center>
  );

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

  const content =
    groupBy === 'none' ? (
      <>
        {renderTaskListBlock(groupedTaskEntries[0]?.rows ?? [], false, routeScope)}
        {hiddenFooter}
      </>
    ) : (
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
                title={renderGroupTitle(group.meta, group.count)}
                variant={'filled'}
                styles={{
                  header: { marginBottom: 8 },
                }}
              >
                {group.subGroups.length > 0 ? (
                  <Accordion gap={6}>
                    {group.subGroups.map((subGroup) => (
                      <AccordionItem
                        defaultExpand
                        indicatorPlacement={'end'}
                        itemKey={`sub-${group.meta.key}-${subGroup.meta.key}`}
                        key={`${group.meta.key}-${subGroup.meta.key}`}
                        paddingBlock={6}
                        paddingInline={14}
                        title={renderGroupTitle(subGroup.meta, subGroup.count, true)}
                      >
                        {renderTaskListBlock(subGroup.rows, true, routeScope)}
                      </AccordionItem>
                    ))}
                  </Accordion>
                ) : (
                  renderTaskListBlock(group.rows, false, routeScope)
                )}
              </AccordionItem>
            );
          })}
        </Accordion>
        {hiddenFooter}
      </>
    );

  // Error is gated ahead of empty by AsyncBoundary, so a failed fetch shows a
  // Retry block instead of the "no tasks" empty. `data` is the
  // store-derived settled signal — see the `data` prop doc above.
  return (
    <AsyncBoundary
      data={data}
      empty={emptyState}
      error={error}
      errorVariant={'block'}
      isEmpty={tasks.length === 0}
      isLoading={isLoading}
      loading={skeleton}
      onRetry={onRetry}
    >
      {content}
    </AsyncBoundary>
  );
});

export default TaskList;

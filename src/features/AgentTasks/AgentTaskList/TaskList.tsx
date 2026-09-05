import { AccordionItem, Block, Center, Empty, Flexbox } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { Divider } from 'antd';
import { cssVar } from 'antd-style';
import { ClipboardCheckIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Components } from 'react-virtuoso';
import { Virtuoso } from 'react-virtuoso';

import AsyncBoundary from '@/components/AsyncBoundary';
import { useTaskStore } from '@/store/task';
import { taskListSelectors } from '@/store/task/selectors';
import { COMPLETE_TASK_LIST_MAX_ITEMS } from '@/store/task/slices/list/action';
import type { TaskListItem } from '@/store/task/slices/list/initialState';

import type { TaskItemRouteScope } from '../features/AgentTaskItem';
import AgentTaskItem from '../features/AgentTaskItem';
import type { TaskGroupBy, TaskGroupMeta, TaskListViewOptions } from './listViewOptions';
import {
  buildTaskRows,
  collapseSubTasks,
  compareTaskItems,
  groupTaskItems,
  HIDDEN_WHEN_COMPLETED_STATUSES,
} from './listViewOptions';
import TaskGroupLabel from './TaskGroupLabel';
import TaskItemSkeleton from './TaskItemSkeleton';
import type { TaskListGroupEntry, TaskListVirtualItem } from './taskListVirtualModel';
import { flattenTaskListEntries } from './taskListVirtualModel';
import TaskRowIndent from './TaskRowIndent';
import { useClosestScrollParent } from './useClosestScrollParent';

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

/** Row height the window sizes itself by before it has measured real rows. */
const DEFAULT_ROW_HEIGHT = 52;

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

/**
 * Group / sub-group header as a standalone (context-free) AccordionItem so the
 * virtual list keeps the Accordion look while owning the expand state itself.
 * It renders no content: the rows it opens are the sibling virtual items.
 */
const TaskGroupHeader = memo<{
  item: Extract<TaskListVirtualItem, { kind: 'group' | 'subGroup' }>;
  onToggle: (key: string) => void;
}>(({ item, onToggle }) => {
  const sub = item.kind === 'subGroup';
  return (
    <div style={{ paddingTop: item.first ? 0 : sub ? 6 : 16 }}>
      <AccordionItem
        expand={!item.collapsed}
        indicatorPlacement={'end'}
        itemKey={item.key}
        paddingBlock={sub ? 6 : 8}
        paddingInline={14}
        title={renderGroupTitle(item.meta, item.count, sub)}
        variant={sub ? undefined : 'filled'}
        onExpandChange={() => onToggle(item.key)}
      />
    </div>
  );
});

interface TaskListVirtualContext {
  footer: ReactNode;
}

const TaskListFooter = ({ context }: { context?: TaskListVirtualContext }) => (
  <>{context?.footer}</>
);

const VIRTUAL_LIST_COMPONENTS: Components<TaskListVirtualItem, TaskListVirtualContext> = {
  Footer: TaskListFooter,
};

const TaskList = memo<TaskListProps>((props) => {
  const { data, error, isLoading, items, onRetry, onShowHiddenCompleted, options, routeScope } =
    props;
  const { t } = useTranslation('chat');
  const storeTasks = useTaskStore(taskListSelectors.taskList);
  const storeTasksTotal = useTaskStore(taskListSelectors.taskListTotal);
  const tasks = items ?? storeTasks;
  // The store list is fetched in full up to a ceiling; past it the server's
  // `total` still counts every task, so say the list is a subset rather than
  // let the missing rows vanish silently. Alternate collections (`items`)
  // paginate on their own.
  const isTruncated = !items && storeTasksTotal > COMPLETE_TASK_LIST_MAX_ITEMS;
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
  const groupedTaskEntries = useMemo((): TaskListGroupEntry[] => {
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
        return { count: groupedTasks.length, meta, rows: toRows(groupedTasks), subGroups: [] };
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

  // Collapse state lives here (not in the Accordion) because headers and rows
  // are flattened into one virtual list; a collapsed key simply drops its rows
  // from that list. Keys survive a re-group only when the group keys do.
  const [collapsedKeys, setCollapsedKeys] = useState<ReadonlySet<string>>(() => new Set());
  const toggleCollapsed = useCallback((key: string) => {
    setCollapsedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const virtualItems = useMemo(
    () =>
      flattenTaskListEntries(groupedTaskEntries, {
        collapsed: collapsedKeys,
        grouped: groupBy !== 'none',
      }),
    [collapsedKeys, groupBy, groupedTaskEntries],
  );

  // The page scrolls in an ancestor (`WideScreenContainer`'s wrapper), with the
  // inline composer above this list. Windowing against that ancestor keeps the
  // page layout intact instead of nesting a second scroller.
  const { ref: anchorRef, scrollParent } = useClosestScrollParent();

  const renderItem = useCallback(
    (_index: number, item: TaskListVirtualItem) => {
      if (item.kind !== 'row') return <TaskGroupHeader item={item} onToggle={toggleCollapsed} />;
      return (
        // Matches the 2px row gap the former Block wrapper gave the list.
        <div style={{ paddingBlock: 1, paddingInline: 2 }}>
          <TaskRowIndent depth={item.row.depth} muted={item.row.isParentContext}>
            <AgentTaskItem routeScope={routeScope} task={item.row.task} />
          </TaskRowIndent>
          {item.showDivider && <Divider dashed style={{ margin: 0 }} />}
        </div>
      );
    },
    [routeScope, toggleCollapsed],
  );

  const skeleton = (
    <Block gap={2} padding={2} variant={'borderless'}>
      {Array.from({ length: 5 }).map((_, index) => (
        <div key={`task-skeleton-${index}`}>
          <TaskItemSkeleton />
          {index !== 4 && <Divider dashed style={{ margin: 0 }} />}
        </div>
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

  const truncatedFooter = isTruncated && (
    <Flexbox horizontal align={'center'} justify={'center'} paddingBlock={16}>
      <Text fontSize={13} type={'secondary'}>
        {t('taskList.truncated', { loaded: tasks.length, total: storeTasksTotal })}
      </Text>
    </Flexbox>
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
      <div ref={anchorRef} style={{ width: '100%' }}>
        {scrollParent && (
          <Virtuoso
            // Footer belongs to the window so it follows the last rendered row
            // rather than sitting under an unrendered tail.
            components={VIRTUAL_LIST_COMPONENTS}
            computeItemKey={(_index, item) => item.key}
            customScrollParent={scrollParent}
            data={virtualItems}
            defaultItemHeight={DEFAULT_ROW_HEIGHT}
            increaseViewportBy={{ bottom: 600, top: 600 }}
            itemContent={renderItem}
            context={{
              footer: (
                <>
                  {hiddenFooter}
                  {truncatedFooter}
                </>
              ),
            }}
          />
        )}
      </div>
    </AsyncBoundary>
  );
});

export default TaskList;

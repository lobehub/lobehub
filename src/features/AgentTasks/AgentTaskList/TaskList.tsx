import { matchesTaskListFilter, type TaskListFilter } from '@lobechat/types';
import {
  AccordionHeader,
  AccordionItem,
  AccordionRoot,
  AccordionTrigger,
  ActionIcon,
  Block,
  Center,
  cssVar,
  Divider,
  Empty,
  Flexbox,
  Text,
} from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { ClipboardCheckIcon, Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Components } from 'react-virtuoso';
import { Virtuoso } from 'react-virtuoso';

import AsyncBoundary from '@/components/AsyncBoundary';
import { useTaskStore } from '@/store/task';
import { taskListSelectors } from '@/store/task/selectors';
import { COMPLETE_TASK_LIST_MAX_ITEMS } from '@/store/task/slices/list/action';
import type { TaskListItem } from '@/store/task/slices/list/initialState';

import { createTaskModal } from '../CreateTaskModal';
import type { TaskItemRouteScope } from '../features/AgentTaskItem';
import AgentTaskItem from '../features/AgentTaskItem';
import {
  getKanbanCreateTaskModalProps,
  getTaskGroupCreateDefaults,
  getTaskSubGroupCreateDefaults,
} from './kanbanBoardModel';
import type { TaskGroupBy, TaskGroupMeta, TaskListViewOptions } from './listViewOptions';
import {
  buildTaskRows,
  collapseSubTasks,
  compareTaskItems,
  groupTaskItems,
  isTaskHiddenByCompletedFilter,
} from './listViewOptions';
import SelectableTaskRow, { selectableTaskItemClassName } from './selection/SelectableTaskRow';
import { useTaskSelectionStore } from './selection/store';
import TaskBulkActionBar from './selection/TaskBulkActionBar';
import { isEditableTarget } from './selection/taskSelectionModel';
import { useSelectionScope } from './selection/useSelectionScope';
import TaskGroupLabel from './TaskGroupLabel';
import TaskItemSkeleton from './TaskItemSkeleton';
import type { TaskListGroupEntry, TaskListVirtualItem } from './taskListVirtualModel';
import { flattenTaskListEntries } from './taskListVirtualModel';
import TaskRowIndent from './TaskRowIndent';
import { useClosestScrollParent } from './useClosestScrollParent';

/** Scope inherited by tasks created from a group header. */
export interface TaskListCreateScope {
  agentId?: string;
  projectId?: string;
}

interface TaskListProps {
  /**
   * Offers a create entry on group headers (like the board's column headers),
   * pinning the group's field on the new task. Omit where creating is not
   * allowed or the collection cannot guarantee where a new task lands.
   */
  createScope?: TaskListCreateScope;
  /**
   * Settled signal — truthy once the list behind `queryKey` has a value in the
   * store, `undefined` while unsettled. Derived from the same entry as the rows,
   * so it never disagrees with the empty signal.
   */
  data?: unknown;
  /** Call to action under the empty state, e.g. creating the collection's first task. */
  emptyAction?: ReactNode;
  emptyDescription?: string;
  /** Thrown error from the list SWR — surfaced as a failure state, not a skeleton. */
  error?: unknown;
  /**
   * The page filter the rows were fetched with. Re-applied locally so a row
   * edited out of it (priority changed, assignee swapped) leaves at once.
   */
  filter?: TaskListFilter;
  /** First-load / retry in flight (SWR `isLoading`). */
  isLoading?: boolean;
  /** Optional list source for alternate task collections such as scheduled tasks. */
  items?: TaskListItem[];
  onRetry?: () => void;
  onShowHiddenCompleted?: () => void;
  options: TaskListViewOptions;
  /** Store entry of the list to render (`useFetchTaskList().queryKey`) when `items` is absent. */
  queryKey?: string;
  routeScope?: TaskItemRouteScope;
  /**
   * Identity of the collection behind `items` (tab, sub-scope, page, owner).
   * The selection is dropped whenever it changes; without it every items-backed
   * collection shares one scope, and a task present in two of them would stay
   * selected across the switch.
   */
  selectionScope?: string;
}

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

const styles = stylex.create({
  // A flex box centres the icon instead of a transform on the icon itself,
  // which its own pressed / focused styles would override.
  action: {
    alignItems: 'center',
    display: 'flex',
    insetBlock: 0,
    insetInlineEnd: 10,
    position: 'absolute',
  },
  header: {
    position: 'relative',
  },
});

/** Room kept at the title's end for the create entry, so a sub-group rule stops before it. */
const CREATE_ENTRY_GUTTER = 28;

const renderGroupTitle = (
  group: TaskGroupMeta,
  count: number,
  sub?: boolean,
  withCreateEntry?: boolean,
) => (
  <Flexbox
    horizontal
    align={'center'}
    gap={8}
    justify={'space-between'}
    style={withCreateEntry ? { marginInlineEnd: CREATE_ENTRY_GUTTER } : undefined}
  >
    <TaskGroupLabel group={group} />
    <Text fontSize={12} type={'secondary'}>
      {count}
    </Text>
    {sub ? <Divider style={{ borderColor: cssVar.colorBorder, flex: 1 }} /> : <Flexbox flex={1} />}
  </Flexbox>
);

/**
 * Group / sub-group header as a standalone (context-free) AccordionItem so the
 * virtual list keeps the Accordion look while owning the expand state itself.
 * It renders no content: the rows it opens are the sibling virtual items.
 */
const TaskGroupHeader = memo<{
  createScope?: TaskListCreateScope;
  item: Extract<TaskListVirtualItem, { kind: 'group' | 'subGroup' }>;
  onToggle: (key: string) => void;
}>(({ createScope, item, onToggle }) => {
  const { t } = useTranslation('chat');
  const sub = item.kind === 'subGroup';
  const createDefaults = !createScope
    ? undefined
    : item.kind === 'subGroup'
      ? getTaskSubGroupCreateDefaults(item.parentMeta, item.meta)
      : getTaskGroupCreateDefaults(item.meta);
  const openCreate = useCallback(() => {
    if (!createScope || !createDefaults) return;
    createTaskModal(getKanbanCreateTaskModalProps(createDefaults, createScope));
  }, [createDefaults, createScope]);

  return (
    <div style={{ paddingTop: item.first ? 0 : sub ? 6 : 16 }}>
      <div {...stylex.props(styles.header)}>
        <AccordionRoot
          indicatorPlacement={'start'}
          value={item.collapsed ? [] : [item.key]}
          variant={sub ? 'borderless' : 'filled'}
          onValueChange={() => onToggle(item.key)}
        >
          <AccordionItem value={item.key}>
            <AccordionHeader>
              <AccordionTrigger style={{ paddingBlock: sub ? 6 : 8, paddingInline: 14 }}>
                {renderGroupTitle(item.meta, item.count, sub, !!createDefaults)}
              </AccordionTrigger>
            </AccordionHeader>
          </AccordionItem>
        </AccordionRoot>
        {createDefaults && (
          // Outside the trigger so clicking it opens the modal without toggling
          // the group; the collapse indicator sits at the start (like Linear),
          // so the entry takes the header's far end.
          <div {...stylex.props(styles.action)}>
            <ActionIcon
              icon={Plus}
              size={'small'}
              title={t('taskList.kanban.addTask')}
              onClick={openCreate}
            />
          </div>
        )}
      </div>
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
  const {
    createScope,
    data,
    error,
    filter,
    isLoading,
    items,
    onRetry,
    onShowHiddenCompleted,
    options,
    queryKey,
    routeScope,
  } = props;
  const { t } = useTranslation('chat');
  const storeTasks = useTaskStore(taskListSelectors.taskList(queryKey));
  const storeTasksTotal = useTaskStore(taskListSelectors.taskListTotal(queryKey));
  const sourceTasks = items ?? storeTasks;
  const tasks = useMemo(
    () =>
      filter ? sourceTasks.filter((task) => matchesTaskListFilter(task, filter)) : sourceTasks,
    [filter, sourceTasks],
  );
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
      options.completedTasks === 'all'
        ? tasks
        : tasks.filter((task) => !isTaskHiddenByCompletedFilter(task, options.completedTasks)),
    [tasks, options.completedTasks],
  );
  // Only the completed/canceled cut feeds the "hidden by display options"
  // footer — its "Show" action resets `completedTasks` to 'all', so folding the sub-task
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

  // Selectable rows in display order, collapsed groups included (⌘A selects
  // every task the current view shows, not only the expanded ones). Grey
  // parent-context rows only give a nested child its place; they are not part
  // of the view's result set.
  const selectableIds = useMemo(() => {
    const ids = new Set<string>();
    for (const entry of groupedTaskEntries) {
      const rows =
        entry.subGroups.length > 0 ? entry.subGroups.flatMap((sub) => sub.rows) : entry.rows;
      for (const row of rows) if (!row.isParentContext) ids.add(row.task.id);
    }
    return [...ids];
  }, [groupedTaskEntries]);
  const listRef = useRef<HTMLDivElement>(null);
  const selectableIdsRef = useRef(selectableIds);
  selectableIdsRef.current = selectableIds;
  const getSelectionOrder = useCallback(() => selectableIdsRef.current, []);

  // A selection never outlives the rows it names: prune on every list change,
  // and drop it when this list (or its collection) goes away.
  useEffect(() => {
    useTaskSelectionStore.getState().prune(new Set(selectableIds));
  }, [selectableIds]);
  const selectionScope = props.selectionScope ?? (items ? 'items' : (queryKey ?? ''));
  useSelectionScope(selectionScope);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isEditableTarget(event.target)) return;
      // Only when nothing else holds focus, or focus is on the list itself:
      // ⌘A over a side panel's text keeps selecting that text, and Esc inside
      // a drawer or popover stays theirs.
      const target = event.target as Node | null;
      const onList = !!target && !!listRef.current?.contains(target);
      if (target !== document.body && !onList) return;
      const selection = useTaskSelectionStore.getState();
      if (
        event.key.toLowerCase() === 'a' &&
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        !event.altKey
      ) {
        if (selectableIdsRef.current.length === 0) return;
        event.preventDefault();
        selection.selectAll(selectableIdsRef.current);
        return;
      }
      if (event.key === 'Escape' && selection.selectedIds.length > 0 && !selection.progress) {
        event.preventDefault();
        selection.clear();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
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
      if (item.kind !== 'row')
        return <TaskGroupHeader createScope={createScope} item={item} onToggle={toggleCollapsed} />;
      return (
        // Matches the 2px row gap the former Block wrapper gave the list.
        <div style={{ paddingBlock: 1, paddingInline: 2 }}>
          <TaskRowIndent depth={item.row.depth} muted={item.row.isParentContext}>
            {item.row.isParentContext ? (
              <AgentTaskItem routeScope={routeScope} task={item.row.task} />
            ) : (
              <SelectableTaskRow
                id={item.row.task.id}
                order={getSelectionOrder}
                label={[item.row.task.identifier, item.row.task.name?.trim()]
                  .filter(Boolean)
                  .join(' ')}
              >
                <AgentTaskItem
                  className={selectableTaskItemClassName}
                  routeScope={routeScope}
                  task={item.row.task}
                />
              </SelectableTaskRow>
            )}
          </TaskRowIndent>
          {item.showDivider && <Divider dashed style={{ margin: 0 }} />}
        </div>
      );
    },
    [createScope, getSelectionOrder, routeScope, toggleCollapsed],
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
        action={props.emptyAction}
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
      <div ref={listRef} style={{ width: '100%' }}>
        <TaskBulkActionBar tasks={tasks} />
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
      </div>
    </AsyncBoundary>
  );
});

export default TaskList;

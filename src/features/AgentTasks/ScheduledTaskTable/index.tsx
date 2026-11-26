import { matchesTaskListFilter, type TaskListFilter } from '@lobechat/types';
import {
  AccordionHeader,
  AccordionItem,
  AccordionRoot,
  AccordionTrigger,
  Center,
  Divider,
  Empty,
  Flexbox,
  Icon,
  Skeleton,
  Text,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CalendarClockIcon, CircleAlert } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import { type ExecutionStatusVisual, TASK_STATUS_VISUALS } from '@/components/ExecutionStatus';
import type { TaskListItem } from '@/store/task/slices/list/initialState';
import { useDensityTokens } from '@/styles/density';
import { sx } from '@/styles/sx';

import SelectableTaskRow from '../AgentTaskList/selection/SelectableTaskRow';
import TaskBulkActionBar from '../AgentTaskList/selection/TaskBulkActionBar';
import { useTaskListSelection } from '../AgentTaskList/selection/useTaskListSelection';
import type { TaskItemRouteScope } from '../features/AgentTaskItem';
import { ScheduledTaskRow } from './ScheduledTaskRow';
import { groupScheduleRows, type ScheduleGroupKey } from './scheduleState';
import { scheduleTableStyles } from './style';

// The header and the skeleton line up with the row content: the same 2px row
// inset, then the 20px selection gutter `SelectableTaskRow` reserves.
const styles = stylex.create({
  gutter: {
    paddingInlineStart: '20px',
  },
  rowInset: {
    paddingInline: '2px',
  },
});

const GROUP_LABEL_KEYS = {
  attention: 'taskList.scheduled.group.attention',
  running: 'taskList.scheduled.group.running',
  scheduled: 'taskList.scheduled.group.scheduled',
} as const satisfies Record<ScheduleGroupKey, string>;

const GROUP_VISUALS: Record<ScheduleGroupKey, ExecutionStatusVisual> = {
  attention: { color: cssVar.colorWarning, icon: CircleAlert },
  running: TASK_STATUS_VISUALS.running,
  scheduled: TASK_STATUS_VISUALS.scheduled,
};

/** How often the table re-reads the clock: next runs, elapsed times and sections follow it. */
const CLOCK_INTERVAL_MS = 30_000;

const useNow = (intervalMs: number): Date => {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
};

const SKELETON_ROWS = 5;

const ScheduledTaskTableSkeleton = () => {
  const { listRowHeight } = useDensityTokens();
  return (
    <div {...stylex.props(scheduleTableStyles.container)}>
      {Array.from({ length: SKELETON_ROWS }, (_, index) => (
        <div {...stylex.props(styles.rowInset)} key={index}>
          <div {...sx(styles.gutter, { paddingBlock: (listRowHeight - 16) / 2 })}>
            <div {...stylex.props(scheduleTableStyles.grid)}>
              <div {...stylex.props(scheduleTableStyles.taskCell)}>
                <Skeleton height={16} style={{ minWidth: 0 }} width={'60%'} />
              </div>
              <div {...stylex.props(scheduleTableStyles.cadenceCell)}>
                <Skeleton height={14} style={{ minWidth: 0 }} width={96} />
              </div>
              <div {...stylex.props(scheduleTableStyles.stateCell)}>
                <Skeleton height={14} style={{ minWidth: 0 }} width={120} />
              </div>
              <div {...stylex.props(scheduleTableStyles.runsCell)}>
                <Skeleton height={14} style={{ minWidth: 0 }} width={88} />
              </div>
              <div {...stylex.props(scheduleTableStyles.assigneeCell)}>
                <Skeleton.Avatar shape={'circle'} size={'small'} />
              </div>
            </div>
          </div>
          {index !== SKELETON_ROWS - 1 && <Divider dashed style={{ margin: 0 }} />}
        </div>
      ))}
    </div>
  );
};

interface ScheduledTaskTableProps {
  /**
   * Settled signal: truthy once the page behind `tasks` has a value in the
   * store, `undefined` while unsettled.
   */
  data?: unknown;
  /** Call to action under the empty state, e.g. creating the first scheduled task. */
  emptyAction?: ReactNode;
  emptyDescription?: string;
  /** Thrown error from the list fetch: surfaced as a failure state, not a skeleton. */
  error?: unknown;
  /**
   * The page filter the rows were fetched with. Re-applied locally so a row
   * edited out of it leaves at once.
   */
  filter?: TaskListFilter;
  /** The table already belongs to one project, so its rows do not repeat it. */
  hideProject?: boolean;
  /** First load or retry in flight. */
  isLoading?: boolean;
  onRetry?: () => void;
  routeScope: TaskItemRouteScope;
  /** Identity of the collection behind `tasks`; the selection is dropped whenever it changes. */
  selectionScope: string;
  tasks: TaskListItem[];
}

/**
 * Recurring tasks as a schedule, not as a to-do list: sectioned by whether
 * each one needs the user, is running, or is waiting for its next run, with
 * the waiting ones ordered by when they fire.
 */
export const ScheduledTaskTable = ({
  data,
  emptyAction,
  emptyDescription,
  error,
  filter,
  hideProject,
  isLoading,
  onRetry,
  routeScope,
  selectionScope,
  tasks: sourceTasks,
}: ScheduledTaskTableProps) => {
  const { t } = useTranslation('chat');
  const now = useNow(CLOCK_INTERVAL_MS);
  const tasks = useMemo(
    () =>
      filter ? sourceTasks.filter((task) => matchesTaskListFilter(task, filter)) : sourceTasks,
    [filter, sourceTasks],
  );
  const groups = useMemo(() => groupScheduleRows(tasks, now), [tasks, now]);

  const [collapsedKeys, setCollapsedKeys] = useState<ReadonlySet<ScheduleGroupKey>>(
    () => new Set(),
  );
  const toggleCollapsed = (key: ScheduleGroupKey) =>
    setCollapsedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // Display order, collapsed sections included: ⌘A selects every task the table lists.
  const selectableIds = useMemo(
    () => groups.flatMap((group) => group.rows.map((row) => row.task.id)),
    [groups],
  );
  const listRef = useRef<HTMLDivElement>(null);
  const { getSelectionOrder } = useTaskListSelection({
    listRef,
    scope: selectionScope,
    selectableIds,
  });

  return (
    <AsyncBoundary
      data={data}
      error={error}
      errorVariant={'block'}
      isEmpty={tasks.length === 0}
      isLoading={isLoading}
      loading={<ScheduledTaskTableSkeleton />}
      empty={
        <Center height={'80vh'} width={'100%'}>
          <Empty
            action={emptyAction}
            description={emptyDescription ?? t('taskList.scheduled.empty')}
            icon={CalendarClockIcon}
          />
        </Center>
      }
      onRetry={onRetry}
    >
      <div ref={listRef} {...stylex.props(scheduleTableStyles.container)}>
        <TaskBulkActionBar tasks={tasks} />
        <div {...stylex.props(styles.rowInset, styles.gutter)}>
          <div {...stylex.props(scheduleTableStyles.grid, scheduleTableStyles.head)}>
            <span>{t('taskList.scheduled.columns.task')}</span>
            <span>{t('taskList.scheduled.columns.cadence')}</span>
            <span>{t('taskList.scheduled.columns.nextRun')}</span>
            <span>{t('taskList.scheduled.columns.recentRuns')}</span>
            <span style={{ textAlign: 'end' }}>{t('taskList.scheduled.columns.assignee')}</span>
          </div>
        </div>
        <Flexbox gap={16}>
          {groups.map((group) => {
            const collapsed = collapsedKeys.has(group.key);
            const visual = GROUP_VISUALS[group.key];
            return (
              <section key={group.key}>
                <AccordionRoot
                  indicatorPlacement={'start'}
                  value={collapsed ? [] : [group.key]}
                  variant={'filled'}
                  onValueChange={() => toggleCollapsed(group.key)}
                >
                  <AccordionItem value={group.key}>
                    <AccordionHeader>
                      <AccordionTrigger style={{ paddingBlock: 8, paddingInline: 14 }}>
                        <Flexbox horizontal align={'center'} gap={8}>
                          <Icon color={visual.color} icon={visual.icon} size={16} />
                          <Text weight={500}>{t(GROUP_LABEL_KEYS[group.key])}</Text>
                          <Text fontSize={12} type={'secondary'}>
                            {group.rows.length}
                          </Text>
                        </Flexbox>
                      </AccordionTrigger>
                    </AccordionHeader>
                  </AccordionItem>
                </AccordionRoot>
                {!collapsed &&
                  group.rows.map(({ state, task }, index) => (
                    // Matches the 2px row gap of the ordinary task list.
                    <div key={task.id} style={{ paddingBlock: 1, paddingInline: 2 }}>
                      <SelectableTaskRow
                        id={task.id}
                        label={[task.identifier, task.name?.trim()].filter(Boolean).join(' ')}
                        order={getSelectionOrder}
                      >
                        <ScheduledTaskRow
                          hideProject={hideProject}
                          now={now}
                          routeScope={routeScope}
                          state={state}
                          task={task}
                        />
                      </SelectableTaskRow>
                      {index !== group.rows.length - 1 && <Divider dashed style={{ margin: 0 }} />}
                    </div>
                  ))}
              </section>
            );
          })}
        </Flexbox>
      </div>
    </AsyncBoundary>
  );
};

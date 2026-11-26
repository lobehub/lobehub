import type { TaskStatus } from '@lobechat/types';
import { ContextMenuTrigger, Flexbox, Icon, Text, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { LockIcon, TriangleAlert } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { type ExecutionStatusVisual, TASK_STATUS_VISUALS } from '@/components/ExecutionStatus';
import TaskLabelChips from '@/features/TaskLabels/TaskLabelChips';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import type { TaskListItem } from '@/store/task/slices/list/initialState';
import { useDensityTokens } from '@/styles/density';
import { sx } from '@/styles/sx';

import {
  formatIntervalLabel,
  formatScheduleDescription,
  formatTimezoneName,
} from '../AgentTaskDetail/scheduler/helpers';
import type { TaskItemRouteScope } from '../features/AgentTaskItem';
import { TaskAssigneeCell } from '../features/TaskAssigneeCell';
import TaskProjectChip from '../features/TaskProjectChip';
import { useTaskItemContextMenu } from '../features/useTaskItemContextMenu';
import { taskDetailPath } from '../shared/taskDetailPath';
import { useTaskListOriginState } from '../shared/taskListOrigin';
import { RecentRuns } from './RecentRuns';
import type { ScheduleHealth, ScheduleState } from './scheduleState';
import { ScheduleStateCell } from './ScheduleStateCell';
import { scheduleTableStyles } from './style';

const styles = stylex.create({
  row: {
    cursor: 'pointer',
    outlineColor: { 'default': null, ':focus-visible': cssVar.colorPrimary },
    outlineOffset: { 'default': null, ':focus-visible': '-2px' },
    outlineStyle: { 'default': null, ':focus-visible': 'solid' },
    outlineWidth: { 'default': null, ':focus-visible': '2px' },
  },
});

/**
 * A task's glyph follows what its schedule is doing, not its raw status: a
 * heartbeat whose fuse blew still has the `scheduled` status.
 */
const HEALTH_VISUALS: Record<ScheduleHealth, ExecutionStatusVisual> = {
  awaitingHuman: TASK_STATUS_VISUALS.paused,
  awaitingReview: TASK_STATUS_VISUALS.paused,
  overrun: { color: cssVar.colorWarning, icon: TriangleAlert },
  running: TASK_STATUS_VISUALS.running,
  scheduled: TASK_STATUS_VISUALS.scheduled,
  stopped: TASK_STATUS_VISUALS.failed,
};

const TASK_STATUS_SET = new Set<string>(Object.keys(TASK_STATUS_VISUALS));
const toTaskStatus = (status: string): TaskStatus =>
  TASK_STATUS_SET.has(status) ? (status as TaskStatus) : 'backlog';

const FLEX_MIN_WIDTH_0 = { minWidth: 0 };

interface ScheduledTaskRowProps {
  /** The surface already belongs to one project, so its rows do not repeat it. */
  hideProject?: boolean;
  now: Date;
  routeScope: TaskItemRouteScope;
  state: ScheduleState;
  task: TaskListItem;
}

/**
 * One recurring task as a row of the scheduled tasks table: what it is, how
 * often it runs, when it runs next (or why it will not), how its last runs
 * went, and who runs it.
 */
export const ScheduledTaskRow = ({
  hideProject,
  now,
  routeScope,
  state,
  task,
}: ScheduledTaskRowProps) => {
  const { t, i18n } = useTranslation('chat');
  const { fontSize, listRowHeight } = useDensityTokens();
  const navigate = useWorkspaceAwareNavigate();
  const taskListOriginState = useTaskListOriginState();
  const { items: contextMenuItems, onContextMenu } = useTaskItemContextMenu(task, routeScope);

  const open = () =>
    navigate(
      taskDetailPath(
        task.identifier,
        routeScope === 'agent' ? (task.assigneeAgentId ?? undefined) : undefined,
        task.name,
      ),
      { state: taskListOriginState },
    );

  const handleKeyDown = (event: KeyboardEvent) => {
    // Only the row itself: a key pressed inside a cell control belongs to it.
    if (event.target !== event.currentTarget) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    open();
  };

  const visual = HEALTH_VISUALS[state.health];
  const name = task.name?.trim();

  // `automationMode` is the source of truth: a task keeps stale fields of the
  // mode it was on before.
  const cadence =
    task.automationMode === 'schedule' && task.schedulePattern
      ? formatScheduleDescription(task.schedulePattern, t)
      : task.automationMode === 'heartbeat' && task.heartbeatInterval
        ? t('taskSchedule.tag.every', {
            interval: formatIntervalLabel(task.heartbeatInterval, t),
          })
        : undefined;
  const timezone =
    task.automationMode === 'schedule' && task.scheduleTimezone
      ? formatTimezoneName(task.scheduleTimezone, i18n.language)
      : undefined;

  return (
    <ContextMenuTrigger items={contextMenuItems} onContextMenu={onContextMenu}>
      <div
        {...sx(scheduleTableStyles.grid, styles.row, {
          fontSize,
          paddingBlock: (listRowHeight - 24) / 2,
        })}
        role={'link'}
        tabIndex={0}
        onClick={open}
        onKeyDown={handleKeyDown}
      >
        <div {...stylex.props(scheduleTableStyles.taskCell)}>
          <Flexbox horizontal align={'center'} gap={8} style={FLEX_MIN_WIDTH_0}>
            <Icon color={visual.color} icon={visual.icon} size={16} style={{ flex: 'none' }} />
            {task.visibility === 'private' && (
              <Tooltip title={t('createTask.visibility.helperPrivate')}>
                <Icon color={cssVar.colorTextDescription} icon={LockIcon} size={14} />
              </Tooltip>
            )}
            {name && (
              <Text style={{ flex: 'none' }} type={'secondary'}>
                {task.identifier}
              </Text>
            )}
            <Text ellipsis style={FLEX_MIN_WIDTH_0} weight={500}>
              {name || task.identifier}
            </Text>
            <TaskLabelChips labels={task.labels} max={2} />
            {!hideProject && <TaskProjectChip projectId={task.projectId} />}
          </Flexbox>
        </div>
        <div {...stylex.props(scheduleTableStyles.cadenceCell)}>
          <Tooltip title={timezone && cadence ? `${cadence} · ${timezone}` : undefined}>
            <Text ellipsis type={'secondary'}>
              {cadence}
            </Text>
          </Tooltip>
        </div>
        <div {...stylex.props(scheduleTableStyles.stateCell)}>
          <ScheduleStateCell now={now} state={state} />
        </div>
        <div {...stylex.props(scheduleTableStyles.runsCell)}>
          <RecentRuns now={now} runs={task.recentRuns} />
        </div>
        <div {...stylex.props(scheduleTableStyles.assigneeCell)}>
          <TaskAssigneeCell status={toTaskStatus(task.status)} task={task} />
        </div>
      </div>
    </ContextMenuTrigger>
  );
};

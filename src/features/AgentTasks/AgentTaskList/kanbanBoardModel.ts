import type { TaskStatus } from '@lobechat/types';

import type {
  TaskGroupItem,
  TaskKanbanGroupBy,
  TaskListItem,
} from '@/store/task/slices/list/initialState';

import type { CreateTaskContentProps } from '../CreateTaskModal/CreateTaskContent';
import type { TaskGroupBy, TaskGroupMeta } from './listViewOptions';
import {
  getTaskAssigneeGroupMeta,
  getTaskMemberGroupMeta,
  getTaskPriorityGroupMeta,
  sortGroupEntries,
} from './listViewOptions';

export interface KanbanColumnDefinition {
  droppable: boolean;
  groupMeta?: TaskGroupMeta;
  key: string;
  /**
   * `running` is not a plain status write: dropping a task there starts a run,
   * and the server moves it to `running` once the run is dispatched.
   */
  targetStatus: 'backlog' | 'canceled' | 'completed' | 'running' | null;
}

/**
 * Statuses a task can be started from — mirrors the detail page's Run button.
 * `scheduled` is excluded because automation owns its next run.
 */
export const KANBAN_RUNNABLE_STATUSES = new Set<TaskStatus>([
  'backlog',
  'completed',
  'failed',
  'paused',
]);

export interface KanbanAssigneeUpdate {
  assigneeAgentId?: string | null;
  assigneeUserId?: string | null;
}

export type KanbanColumnHeaderVariant = 'fallback' | 'group' | 'loading';

export const getKanbanColumnHeaderVariant = ({
  hasGroupMeta,
  loading,
}: {
  hasGroupMeta: boolean;
  loading?: boolean;
}): KanbanColumnHeaderVariant => {
  if (loading) return 'loading';
  return hasGroupMeta ? 'group' : 'fallback';
};

export const STATUS_KANBAN_COLUMNS: KanbanColumnDefinition[] = [
  { droppable: true, key: 'backlog', targetStatus: 'backlog' },
  { droppable: true, key: 'running', targetStatus: 'running' },
  { droppable: false, key: 'needsInput', targetStatus: null },
  { droppable: true, key: 'done', targetStatus: 'completed' },
  { droppable: true, key: 'canceled', targetStatus: 'canceled' },
];

export const normalizeKanbanGroupBy = (groupBy: TaskGroupBy): TaskKanbanGroupBy =>
  groupBy === 'assignee' || groupBy === 'member' || groupBy === 'priority' ? groupBy : 'status';

export interface KanbanGroupQueryInput {
  agentId?: string;
  excludeStatuses?: readonly TaskStatus[];
  groupBy: TaskKanbanGroupBy;
  /** Set on the "My tasks" board; mutually exclusive with the other scopes. */
  myTaskScope?: 'assigned' | 'created';
  projectId?: string;
}

export interface KanbanGroupQuery {
  agentId?: string;
  allAgents?: boolean;
  automated?: boolean;
  excludeStatuses?: readonly TaskStatus[];
  groupBy: TaskKanbanGroupBy;
  projectId?: string;
  scope?: 'assigned' | 'created';
}

/**
 * The grouped query one board runs, picked from the scope it was mounted with.
 *
 * Every board except "My tasks" pins `automated: false`, keeping the tasks that
 * still fire on their own out of the columns — they belong to the scheduled
 * roll-up. "My tasks" deliberately sends no automation filter, because its list
 * view sends none either: filtering only on the board side would make the
 * caller's scheduled and heartbeat tasks vanish on the list -> board switch of
 * one and the same collection.
 */
export const buildKanbanGroupQuery = ({
  agentId,
  excludeStatuses,
  groupBy,
  myTaskScope,
  projectId,
}: KanbanGroupQueryInput): KanbanGroupQuery => {
  if (myTaskScope) return { excludeStatuses, groupBy, scope: myTaskScope };
  if (projectId) return { automated: false, excludeStatuses, groupBy, projectId };
  if (agentId) return { agentId, automated: false, excludeStatuses, groupBy };

  return { allAgents: true, automated: false, excludeStatuses, groupBy };
};

export const buildKanbanColumns = (
  taskGroups: TaskGroupItem[],
  groupBy: TaskKanbanGroupBy,
): KanbanColumnDefinition[] => {
  if (groupBy === 'status') return STATUS_KANBAN_COLUMNS;

  const groupEntries = taskGroups.map((group) => {
    const meta =
      groupBy === 'assignee'
        ? getTaskAssigneeGroupMeta(group.assigneeAgentId)
        : groupBy === 'member'
          ? getTaskMemberGroupMeta(group.assigneeUserId)
          : getTaskPriorityGroupMeta(group.priority);
    return [meta, group.tasks as TaskListItem[]] as [TaskGroupMeta, TaskListItem[]];
  });

  return sortGroupEntries(groupEntries, groupBy).map(([groupMeta]) => ({
    droppable: true,
    groupMeta,
    key: groupMeta.key,
    targetStatus: null,
  }));
};

export const getKanbanAssigneeUpdate = (
  task: TaskListItem,
  patch: Partial<TaskListItem>,
): KanbanAssigneeUpdate | undefined => {
  const update: KanbanAssigneeUpdate = {};
  if ('assigneeAgentId' in patch) update.assigneeAgentId = patch.assigneeAgentId ?? null;
  if ('assigneeUserId' in patch) update.assigneeUserId = patch.assigneeUserId ?? null;

  if (
    (update.assigneeAgentId === undefined ||
      (task.assigneeAgentId ?? null) === update.assigneeAgentId) &&
    (update.assigneeUserId === undefined || (task.assigneeUserId ?? null) === update.assigneeUserId)
  ) {
    return;
  }

  return update;
};

export const getKanbanTaskPatch = (
  groupBy: TaskKanbanGroupBy,
  column: KanbanColumnDefinition,
): Partial<TaskListItem> | undefined => {
  if (groupBy === 'assignee' && column.groupMeta?.groupBy === 'assignee') {
    return { assigneeAgentId: column.groupMeta.assigneeId ?? null };
  }
  if (groupBy === 'member' && column.groupMeta?.groupBy === 'member') {
    return { assigneeUserId: column.groupMeta.assigneeUserId ?? null };
  }
  if (groupBy === 'priority' && column.groupMeta?.groupBy === 'priority') {
    return { priority: column.groupMeta.priority ?? 0 };
  }
  if (groupBy === 'status' && column.targetStatus) {
    return { status: column.targetStatus as TaskStatus };
  }
};

/** Pinned on the new task, so it lands in the column it was created from. */
export interface KanbanColumnCreateDefaults {
  assigneeAgentId?: string;
  priority?: number;
}

/**
 * Whether a column offers a create entry, and what the new task is pinned to.
 * `undefined` means no entry: a task created there could not be guaranteed to
 * land in that column.
 */
export const getKanbanColumnCreateDefaults = (
  groupBy: TaskKanbanGroupBy,
  column: KanbanColumnDefinition,
): KanbanColumnCreateDefaults | undefined => {
  if (groupBy === 'status' && column.key === 'backlog') return {};
  if (groupBy === 'priority' && column.groupMeta?.groupBy === 'priority') {
    return { priority: column.groupMeta.priority ?? 0 };
  }
  // The unassigned column has no entry: the modal cannot pin "no agent".
  if (groupBy === 'assignee' && column.groupMeta?.groupBy === 'assignee') {
    const { assigneeId } = column.groupMeta;
    return assigneeId ? { assigneeAgentId: assigneeId } : undefined;
  }
};

/**
 * Props for the create task modal opened from a column. The column's pinned
 * fields are prefilled, so an untouched modal creates the task in this column.
 */
export const getKanbanCreateTaskModalProps = (
  defaults: KanbanColumnCreateDefaults,
  scope: { agentId?: string; projectId?: string },
): CreateTaskContentProps => ({
  agentId: defaults.assigneeAgentId ?? scope.agentId,
  defaultPriority: defaults.priority,
  // An agent-scoped board only holds that agent's tasks.
  lockAssignee: !!scope.agentId,
  projectId: scope.projectId,
  // The board has no inline entry to minimize into.
  showInlineToggle: false,
});

export const canDropTaskIntoKanbanColumn = (
  task: TaskListItem,
  groupBy: TaskKanbanGroupBy,
  column: KanbanColumnDefinition,
): boolean => {
  if (!column.droppable) return false;
  if (groupBy === 'status' && column.targetStatus === 'running') {
    return KANBAN_RUNNABLE_STATUSES.has(task.status as TaskStatus);
  }
  if (groupBy !== 'member' || column.groupMeta?.groupBy !== 'member') return true;

  const targetAssigneeUserId = column.groupMeta.assigneeUserId;
  if (!targetAssigneeUserId) return true;

  return task.visibility !== 'private' || task.createdByUserId === targetAssigneeUserId;
};

export const findKanbanTask = (
  taskGroups: TaskGroupItem[],
  identifier: string,
): TaskListItem | undefined =>
  taskGroups
    .flatMap((group) => group.tasks as TaskListItem[])
    .find((item) => item.identifier === identifier);

export const moveTaskBetweenKanbanGroups = (
  taskGroups: TaskGroupItem[],
  task: TaskListItem,
  targetColumnKey: string,
  patch: Partial<TaskListItem>,
): TaskGroupItem[] => {
  const patchedTask = { ...task, ...patch };

  return taskGroups.map((group) => {
    const tasks = group.tasks as TaskListItem[];
    const filtered = tasks.filter((item) => item.identifier !== task.identifier);
    const removed = filtered.length < tasks.length;

    if (group.key === targetColumnKey) {
      return {
        ...group,
        tasks: [...filtered, patchedTask],
        total: group.total + (removed ? 0 : 1),
      };
    }

    return removed ? { ...group, tasks: filtered, total: Math.max(0, group.total - 1) } : group;
  });
};

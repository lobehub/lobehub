import type { TaskLabelRef, TaskStatus } from '@lobechat/types';

import type {
  TaskGroupItem,
  TaskKanbanGroupBy,
  TaskListItem,
} from '@/store/task/slices/list/initialState';
import { TASK_UNAVAILABLE_PROJECT_GROUP_KEY } from '@/store/task/slices/list/projection';

import type { CreateTaskContentProps } from '../CreateTaskModal/CreateTaskContent';
import type { TaskGroupBy, TaskGroupMeta } from './listViewOptions';
import {
  getTaskAssigneeGroupMeta,
  getTaskLabelGroupId,
  getTaskLabelGroupMeta,
  getTaskMemberGroupMeta,
  getTaskPriorityGroupMeta,
  getTaskProjectGroupMeta,
  isTaskLabelGroupBy,
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
  groupBy === 'assignee' ||
  groupBy === 'member' ||
  groupBy === 'priority' ||
  groupBy === 'project' ||
  isTaskLabelGroupBy(groupBy)
    ? groupBy
    : 'status';

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

/**
 * Folds the columns of projects the caller cannot see into one "Unavailable
 * project" column: the server groups by the raw column, but only the visible
 * project list can name a column. Before that list loads there is nothing to
 * decide from.
 */
export const mergeUnresolvedProjectGroups = <T extends TaskGroupItem>(
  groups: T[],
  projects: ReadonlyArray<{ id: string }> | undefined,
): T[] => {
  if (!projects) return groups;
  const visible = new Set(projects.map((project) => project.id));
  const orphans = groups.filter((group) => group.projectId && !visible.has(group.projectId));
  if (orphans.length === 0) return groups;
  const unavailable = {
    ...orphans[0],
    hasMore: orphans.some((orphan) => orphan.hasMore),
    key: TASK_UNAVAILABLE_PROJECT_GROUP_KEY,
    tasks: orphans.flatMap((orphan) => orphan.tasks),
    total: orphans.reduce((sum, orphan) => sum + orphan.total, 0),
  } as T;
  return [...groups.filter((group) => !orphans.includes(group)), unavailable];
};

export const buildKanbanColumns = (
  taskGroups: TaskGroupItem[],
  groupBy: TaskKanbanGroupBy,
): KanbanColumnDefinition[] => {
  if (groupBy === 'status') return STATUS_KANBAN_COLUMNS;

  const groupEntries = taskGroups.map((group) => {
    const meta = isTaskLabelGroupBy(groupBy)
      ? getTaskLabelGroupMeta(groupBy, group.labelId)
      : groupBy === 'assignee'
        ? getTaskAssigneeGroupMeta(group.assigneeAgentId)
        : groupBy === 'member'
          ? getTaskMemberGroupMeta(group.assigneeUserId)
          : groupBy === 'project'
            ? getTaskProjectGroupMeta(group.projectId)
            : getTaskPriorityGroupMeta(group.priority);
    return [meta, group.tasks as TaskListItem[]] as [TaskGroupMeta, TaskListItem[]];
  });

  return sortGroupEntries(groupEntries, groupBy).map(([groupMeta]) => ({
    // Nobody can file a task under a project they cannot see.
    droppable: !groupMeta.projectUnavailable,
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
  if (groupBy === 'project' && column.groupMeta?.groupBy === 'project') {
    return { projectId: column.groupMeta.projectId ?? null };
  }
  if (groupBy === 'status' && column.targetStatus) {
    return { status: column.targetStatus as TaskStatus };
  }
};

/**
 * The labels a card carries after a drop on a label board: the task's label
 * from the board's group is swapped for the column's (or dropped for "no
 * label"); its other labels stay. `undefined` when the drop changes nothing.
 */
export const getKanbanLabelPatch = (
  task: Pick<TaskListItem, 'labels'>,
  groupBy: TaskKanbanGroupBy,
  column: KanbanColumnDefinition,
): { labels: TaskLabelRef[] } | undefined => {
  const groupId = getTaskLabelGroupId(groupBy);
  const meta = column.groupMeta;
  if (!groupId || !meta || meta.groupBy !== groupBy) return;

  const current = task.labels ?? [];
  const currentInGroup = current.find((label) => label.parentId === groupId);
  const targetId = meta.labelId ?? null;
  if ((currentInGroup?.id ?? null) === targetId) return;

  const rest = current.filter((label) => label.parentId !== groupId);
  return {
    labels: targetId
      ? [...rest, { color: meta.labelColor, id: targetId, name: meta.label, parentId: groupId }]
      : rest,
  };
};

/** Pinned on the new task, so it lands in the column it was created from. */
export interface KanbanColumnCreateDefaults {
  assigneeAgentId?: string;
  /**
   * Labels of a label column (and, when nested, of its parent group); the
   * "No label" column pins none.
   */
  labelIds?: string[];
  priority?: number;
  projectId?: string;
}

/**
 * Whether a task group offers a create entry, and what the new task is pinned
 * to. Shared by board columns and list group headers so both views offer the
 * entry on the same groups. `undefined` means no entry: a task created there
 * could not be guaranteed to land in that group.
 */
export const getTaskGroupCreateDefaults = (
  groupMeta: TaskGroupMeta | undefined,
): KanbanColumnCreateDefaults | undefined => {
  if (isTaskLabelGroupBy(groupMeta?.groupBy)) {
    return groupMeta?.labelId ? { labelIds: [groupMeta.labelId] } : {};
  }
  switch (groupMeta?.groupBy) {
    // New tasks start in backlog, so only that status group can receive one.
    case 'status': {
      return groupMeta.status === 'backlog' ? {} : undefined;
    }
    case 'priority': {
      return { priority: groupMeta.priority ?? 0 };
    }
    // A new task starts without a project, so "No project" pins nothing, and
    // "Unavailable project" has no entry: nobody can file a task under it.
    case 'project': {
      if (groupMeta.projectUnavailable) return undefined;
      return groupMeta.projectId ? { projectId: groupMeta.projectId } : {};
    }
    // The unassigned group has no entry: the modal cannot pin "no agent".
    case 'assignee': {
      return groupMeta.assigneeId ? { assigneeAgentId: groupMeta.assigneeId } : undefined;
    }
  }
};

/**
 * Create defaults of a sub-group: it must satisfy its parent group too, so the
 * entry exists only when both levels offer one, and their pins are combined.
 */
export const getTaskSubGroupCreateDefaults = (
  parentMeta: TaskGroupMeta | undefined,
  subMeta: TaskGroupMeta | undefined,
): KanbanColumnCreateDefaults | undefined => {
  const parent = getTaskGroupCreateDefaults(parentMeta);
  const sub = getTaskGroupCreateDefaults(subMeta);
  if (!parent || !sub) return undefined;
  // Two label groupings each pin one label; the task needs both to sit here.
  const labelIds = [...(parent.labelIds ?? []), ...(sub.labelIds ?? [])];
  return { ...parent, ...sub, ...(labelIds.length > 0 ? { labelIds } : {}) };
};

/**
 * Whether a column offers a create entry, and what the new task is pinned to.
 * `undefined` means no entry: a task created there could not be guaranteed to
 * land in that column.
 */
export const getKanbanColumnCreateDefaults = (
  groupBy: TaskKanbanGroupBy,
  column: KanbanColumnDefinition,
): KanbanColumnCreateDefaults | undefined => {
  if (groupBy === 'status') return column.key === 'backlog' ? {} : undefined;
  if (column.groupMeta?.groupBy !== groupBy) return undefined;
  return getTaskGroupCreateDefaults(column.groupMeta);
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
  defaultLabelIds: defaults.labelIds?.length ? defaults.labelIds : undefined,
  defaultPriority: defaults.priority,
  // An agent-scoped board only holds that agent's tasks.
  lockAssignee: !!scope.agentId,
  projectId: defaults.projectId ?? scope.projectId,
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

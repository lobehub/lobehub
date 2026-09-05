import type { TaskStatus } from '@lobechat/types';

import type {
  TaskGroupItem,
  TaskKanbanGroupBy,
  TaskListItem,
} from '@/store/task/slices/list/initialState';

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
  targetStatus: 'backlog' | 'canceled' | 'completed' | null;
}

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
  { droppable: false, key: 'running', targetStatus: null },
  { droppable: false, key: 'needsInput', targetStatus: null },
  { droppable: true, key: 'done', targetStatus: 'completed' },
  { droppable: true, key: 'canceled', targetStatus: 'canceled' },
];

export const normalizeKanbanGroupBy = (groupBy: TaskGroupBy): TaskKanbanGroupBy =>
  groupBy === 'assignee' || groupBy === 'member' || groupBy === 'priority' ? groupBy : 'status';

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

export const canDropTaskIntoKanbanColumn = (
  task: TaskListItem,
  groupBy: TaskKanbanGroupBy,
  column: KanbanColumnDefinition,
): boolean => {
  if (!column.droppable) return false;
  if (groupBy !== 'member' || column.groupMeta?.groupBy !== 'member') return true;

  const targetAssigneeUserId = column.groupMeta.assigneeUserId;
  if (!targetAssigneeUserId) return true;

  return task.visibility !== 'private' || task.createdByUserId === targetAssigneeUserId;
};

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
